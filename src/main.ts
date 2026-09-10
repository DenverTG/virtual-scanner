import './style.css';
import { Glass } from './glass';
import { Scanner } from './scanner';
import { Input } from './input';
import { Panel } from './panel';
import { UI } from './ui';

// Letter at 300 dpi. The glass and the output share this size; the
// viewport only ever shows a scaled view of it.
const WIDTH = 2550;
const HEIGHT = 3300;

const glass = new Glass(WIDTH, HEIGHT);
const scanner = new Scanner(glass, WIDTH, HEIGHT);

let ui: UI;
const panel = new Panel(document.createElement('div'), {
  onChange: () => {
    ui?.syncScanSettings();
    ui?.updateEffectParams();
  },
});
panel.root.className = 'panel';

ui = new UI(document.getElementById('app')!, {
  glass,
  scanner,
  panel,
  onImagesChanged: () => {},
});
ui.syncScanSettings();

new Input(ui.glassView, glass, {
  onChange: () => {},
  onGestureEnd: () => {},
  onSelect: () => ui.syncButtons(),
});

// Debug handle for the console and for browser tests.
(window as unknown as { scan: unknown }).scan = { glass, scanner, panel };

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  scanner.tick(dt);
  ui.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
