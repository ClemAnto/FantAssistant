import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TimeMachine } from './ui/time-machine/time-machine';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TimeMachine],
  templateUrl: './app.html',
})
export class App {}
