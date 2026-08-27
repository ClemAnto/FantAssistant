import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { GlobalOptionsPanel } from './ui/global-options/global-options';
import { TimeMachine } from './ui/time-machine/time-machine';

@Component({
  selector: 'app-root',
  imports: [GlobalOptionsPanel, RouterOutlet, TimeMachine],
  templateUrl: './app.html',
})
export class App {}
