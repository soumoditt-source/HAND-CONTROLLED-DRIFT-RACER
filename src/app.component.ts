
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { GameComponent } from './components/game/game.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GameComponent],
})
export class AppComponent {
  // Simple component to basically just load our main game component.
  // Keeps things clean, you know?
}
