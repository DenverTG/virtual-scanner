import './style.css';
import { Glass } from './glass';
import { Scanner } from './scanner';
import { Input } from './input';
import { UI } from './ui';

// Letter at 300 dpi. The glass and the output share this size; the
// viewport only ever shows a scaled view of it.
const WIDTH = 2550;
const HEIGHT = 3300;

const glass = new Glass(WIDTH, HEIGHT);
const scanner = new Scanner(glass, WIDTH, HEIGHT);
const ui = new UI(document.getElementById('app')!, {
  glass,
  scanner,
  onImagesChanged: () => {},
});
new Input(ui.glassView, glass, {
  onChange: () => {},
  onGestureEnd: () => {},
  onSelect: () => {},
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  scanner.tick(dt);
  ui.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
