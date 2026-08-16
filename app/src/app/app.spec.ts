import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // I provider VERI e non una lista scritta a mano: il box del viaggio nel tempo monta un
      // `nz-date-picker`, che senza il suo adattatore non si costruisce - e un test montato su una
      // configurazione diversa da quella che spedisce non avrebbe visto niente.
      providers: [...appConfig.providers, provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
