// Everything on screen that is not the glass, the scan loop, the input
// mapping, the effect chain or the panel: toolbar, panes, file loading,
// view drawing, the mobile sheet and saving.

import type { Glass } from './glass';
import type { Scanner } from './scanner';
import { Effects, type EffectParams } from './effects';
import type { Panel } from './panel';
import { handlePos, HANDLE_RADIUS_CSS } from './input';

export interface UIDeps {
  glass: Glass;
  scanner: Scanner;
  panel: Panel;
  /** Images were added, removed, reordered or nudged; a good moment to record undo state. */
  onImagesChanged: () => void;
}

export class UI {
  readonly root: HTMLElement;
  readonly glassView: HTMLCanvasElement;
  readonly outputView: HTMLCanvasElement;
  private readonly glassPane: HTMLElement;
  private readonly outputPane: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly gctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D | null = null;
  private effects: Effects | null = null;
  private readonly deps: UIDeps;
  private scanBtn!: HTMLButtonElement;
  private lidBtn!: HTMLButtonElement;
  private dirBtn!: HTMLButtonElement;
  private revBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private captureBtn!: HTMLButtonElement;
  private selButtons: HTMLButtonElement[] = [];
  private tabButtons: HTMLButtonElement[] = [];
  private mobileTab: 'glass' | 'output' = 'glass';
  private outputDirty = true;

  constructor(root: HTMLElement, deps: UIDeps) {
    this.root = root;
    this.deps = deps;
    root.innerHTML = '';
    root.appendChild(this.buildToolbar());

    const main = document.createElement('main');
    this.glassPane = pane('glassPane', 'glass');
    this.outputPane = pane('outputPane', 'output');
    this.glassView = document.createElement('canvas');
    this.glassView.id = 'glassView';
    this.outputView = document.createElement('canvas');
    this.outputView.id = 'outputView';
    this.glassPane.appendChild(this.glassView);
    this.outputPane.appendChild(this.outputView);
    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.innerHTML = '<div><b>Drop an image</b>, paste one, or use Open.<br>Drag to move · wheel or pinch to scale · shift-drag to rotate</div>';
    this.glassPane.appendChild(this.hint);

    this.rail = document.createElement('aside');
    this.rail.className = 'rail';
    const grip = document.createElement('div');
    grip.className = 'grip';
    grip.innerHTML = '<span></span>';
    this.rail.append(grip, deps.panel.root);
    this.setupSheet(grip);

    main.append(this.glassPane, this.outputPane, this.rail);
    root.appendChild(main);

    this.gctx = this.glassView.getContext('2d')!;
    try {
      this.effects = new Effects(this.outputView);
    } catch (err) {
      console.warn('effects disabled:', err);
      this.octx = this.outputView.getContext('2d')!;
    }

    deps.scanner.onChange = () => {
      this.outputDirty = true;
      this.effects?.markSourceDirty();
    };
    deps.scanner.onEnd = () => this.syncButtons();

    window.addEventListener('resize', () => this.layout());
    this.setupFileLoading();
    this.applyMobileTab();
    this.layout();
    this.syncButtons();
    this.updateEffectParams();
  }

  // ---- toolbar -------------------------------------------------------

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('header');
    bar.className = 'toolbar';

    const open = button('Open', () => this.pickFile());
    this.lidBtn = button('', () => {
      this.deps.glass.lidClosed = !this.deps.glass.lidClosed;
      this.syncButtons();
      this.updateEffectParams();
    });
    this.dirBtn = button('', () => {
      const s = this.deps.scanner;
      s.direction = s.direction === 'vertical' ? 'horizontal' : 'vertical';
      this.syncButtons();
      this.updateEffectParams();
    });

    this.revBtn = button('Reverse', () => {
      this.deps.scanner.reverse = !this.deps.scanner.reverse;
      this.syncButtons();
    });
    this.loopBtn = button('Loop', () => {
      this.deps.scanner.loop = !this.deps.scanner.loop;
      this.syncButtons();
    });
    this.loopBtn.title = 'Sweep continuously; Capture freezes the current pass';
    this.scanBtn = button('Scan', () => this.toggleScan());
    this.scanBtn.classList.add('primary');
    this.captureBtn = button('Capture', () => {
      this.deps.scanner.capture();
      this.captureBtn.disabled = true;
    });
    const save = button('Save PNG', () => this.savePng());

    const fwd = button('Forward', () => this.withSelected((id) => this.deps.glass.bringForward(id)));
    const back = button('Back', () => this.withSelected((id) => this.deps.glass.sendBack(id)));
    const del = button('Delete', () => this.withSelected((id) => this.deps.glass.remove(id)));
    this.selButtons = [fwd, back, del];

    const tabs = document.createElement('span');
    tabs.className = 'tabs';
    const tabGlass = button('Glass', () => this.setMobileTab('glass'));
    const tabOut = button('Output', () => this.setMobileTab('output'));
    tabs.append(tabGlass, tabOut);
    this.tabButtons = [tabGlass, tabOut];

    bar.append(
      open, fwd, back, del, sep(),
      this.lidBtn, this.dirBtn, this.revBtn, this.loopBtn, sep(),
      this.scanBtn, this.captureBtn, save, spacer(), tabs,
    );
    this.setupKeyboard();
    return bar;
  }

  private withSelected(fn: (id: number) => void): void {
    const id = this.deps.glass.selectedId;
    if (id === null) return;
    fn(id);
    this.hint.hidden = this.deps.glass.images.length > 0;
    this.deps.onImagesChanged();
    this.syncButtons();
  }

  syncButtons(): void {
    const { glass, scanner } = this.deps;
    this.lidBtn.textContent = glass.lidClosed ? 'Lid: closed' : 'Lid: open';
    const arrow = scanner.direction === 'vertical' ? (scanner.reverse ? 'up' : 'down') : (scanner.reverse ? 'left' : 'right');
    this.dirBtn.textContent = `Sweep: ${arrow}`;
    this.revBtn.classList.toggle('on', scanner.reverse);
    this.loopBtn.classList.toggle('on', scanner.loop);
    this.scanBtn.textContent = scanner.scanning ? 'Stop' : 'Scan';
    this.scanBtn.classList.toggle('primary', !scanner.scanning);
    this.captureBtn.hidden = !(scanner.loop && scanner.scanning);
    this.captureBtn.disabled = false;
    for (const b of this.selButtons) b.disabled = glass.selectedId === null;
    this.tabButtons[0]?.classList.toggle('on', this.mobileTab === 'glass');
    this.tabButtons[1]?.classList.toggle('on', this.mobileTab === 'output');
  }

  toggleScan(): void {
    const s = this.deps.scanner;
    if (s.scanning) s.stop();
    else {
      this.syncScanSettings();
      s.start();
      if (isMobile()) this.setMobileTab('output');
    }
    this.syncButtons();
  }

  /** Push the scan-loop settings from the panel into the scanner. */
  syncScanSettings(): void {
    const { scanner, panel } = this.deps;
    scanner.secondsPerPass = panel.get<number>('speed');
    scanner.fidelityDpi = panel.get<number>('fidelity');
    scanner.exposure = panel.get<number>('exposure');
  }

  private setMobileTab(tab: 'glass' | 'output'): void {
    this.mobileTab = tab;
    this.applyMobileTab();
    this.layout();
    this.syncButtons();
  }

  private applyMobileTab(): void {
    this.glassPane.classList.toggle('hidden', this.mobileTab !== 'glass');
    this.outputPane.classList.toggle('hidden', this.mobileTab !== 'output');
  }

  // ---- keyboard --------------------------------------------------------

  private setupKeyboard(): void {
    const { glass, scanner } = this.deps;
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (typing && !(t as HTMLInputElement).type?.match(/checkbox|range/)) {
        if (e.key === 'Escape') (t as HTMLElement).blur();
        return;
      }
      const sel = glass.selected;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.toggleScan();
          break;
        case 'h':
        case 'H':
          scanner.hold = true;
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!sel) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowLeft') sel.x -= step;
          if (e.key === 'ArrowRight') sel.x += step;
          if (e.key === 'ArrowUp') sel.y -= step;
          if (e.key === 'ArrowDown') sel.y += step;
          this.nudged = true;
          break;
        }
        case 'Delete':
        case 'Backspace':
          if (sel) {
            e.preventDefault();
            this.withSelected((id) => glass.remove(id));
          }
          break;
        case ']':
          this.withSelected((id) => glass.bringForward(id));
          break;
        case '[':
          this.withSelected((id) => glass.sendBack(id));
          break;
        case 'Escape':
          glass.selectedId = null;
          this.syncButtons();
          break;
        default:
          return;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'h' || e.key === 'H') scanner.hold = false;
      if (e.key.startsWith('Arrow') && this.nudged) {
        this.nudged = false;
        this.deps.onImagesChanged();
      }
    });
    window.addEventListener('blur', () => { scanner.hold = false; });
  }

  private nudged = false;

  // ---- mobile bottom sheet ---------------------------------------------

  private setupSheet(grip: HTMLElement): void {
    const rail = this.rail;
    rail.dataset.sheet = 'half';
    document.body.dataset.sheet = 'half';
    let startY = 0;
    let startH = 0;
    let moved = false;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startH = rail.getBoundingClientRect().height;
      moved = false;
      rail.classList.add('dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!grip.hasPointerCapture(e.pointerId)) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) rail.style.height = `${Math.max(40, Math.min(window.innerHeight * 0.9, startH + dy))}px`;
    });
    const end = (e: PointerEvent) => {
      if (!grip.hasPointerCapture(e.pointerId)) return;
      grip.releasePointerCapture(e.pointerId);
      rail.classList.remove('dragging');
      const h = rail.getBoundingClientRect().height / window.innerHeight;
      let next: string;
      if (!moved) next = rail.dataset.sheet === 'closed' ? 'half' : 'closed';
      else next = h < 0.2 ? 'closed' : h < 0.65 ? 'half' : 'full';
      rail.style.height = '';
      rail.dataset.sheet = next;
      document.body.dataset.sheet = next;
      this.layout();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  // ---- files ---------------------------------------------------------

  private setupFileLoading(): void {
    const body = document.body;
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('dragover');
    });
    body.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) body.classList.remove('dragover');
    });
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      body.classList.remove('dragover');
      const files = [...(e.dataTransfer?.files ?? [])];
      void this.loadFiles(files);
    });
    document.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items ?? [])];
      const files = items
        .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length) void this.loadFiles(files);
    });
  }

  pickFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => void this.loadFiles([...(input.files ?? [])]));
    input.click();
  }

  async loadFiles(files: File[]): Promise<void> {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
        this.deps.glass.addImage(bmp);
      } catch (err) {
        console.warn('could not decode', f.name, err);
      }
    }
    this.hint.hidden = this.deps.glass.images.length > 0;
    this.deps.onImagesChanged();
    this.syncButtons();
  }

  savePng(): void {
    const { scanner } = this.deps;
    let canvas: HTMLCanvasElement = scanner.output;
    if (this.effects) {
      try {
        canvas = this.effects.exportCanvas(scanner.output);
      } catch (err) {
        console.warn('export through effects failed, saving raw scan', err);
      }
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scan-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, 'image/png');
  }

  // ---- effects -------------------------------------------------------

  /** Rebuild the shader parameters from the panel and the scanner. */
  updateEffectParams(): void {
    if (!this.effects) return;
    const { panel, scanner, glass } = this.deps;
    const g = <T extends number | boolean>(id: string) => panel.get<T>(id);
    const p: EffectParams = {
      seed: g('seed'),
      axis: scanner.direction,
      lidOpen: !glass.lidClosed,
      bleedOn: g('bleedOn'), bleedSpread: g('bleedSpread'), bleedIntensity: g('bleedIntensity'),
      leakOn: g('leakOn'), leakReach: g('leakReach'),
      levelsOn: g('levelsOn'), black: g('black'), white: g('white'), gamma: g('gamma'),
      threshOn: g('threshOn'), thresh: g('thresh'), threshSoft: g('threshSoft'),
      dither: g('dither'), ditherCell: g('ditherCell'), ditherAngle: g('ditherAngle'),
      genLoss: g('genLoss'),
      grainOn: g('grainOn'), grain: g('grain'), grainSize: g('grainSize'),
      roughOn: g('roughOn'), rough: g('rough'),
      jitterOn: g('jitterOn'), jitter: g('jitter'),
      streakOn: g('streakOn'), streak: g('streak'), streakWidth: g('streakWidth'),
      dropOn: g('dropOn'), dropout: g('dropout'),
      paperOn: g('paperOn'), tint: g('tint'), vignette: g('vignette'),
    };
    this.effects.setParams(p);
    this.outputDirty = true;
  }

  // ---- layout and drawing -------------------------------------------

  layout(): void {
    const { glass } = this.deps;
    fitCanvas(this.glassView, this.glassPane, glass.width / glass.height);
    fitCanvas(this.outputView, this.outputPane, glass.width / glass.height);
    this.outputDirty = true;
  }

  /** Called every animation frame. */
  draw(): void {
    this.drawGlass();
    if (this.outputDirty || this.effects?.needsRender) {
      this.drawOutput();
      this.outputDirty = false;
    }
  }

  private drawGlass(): void {
    const { glass, scanner, panel } = this.deps;
    const ctx = this.gctx;
    const cw = this.glassView.width;
    const ch = this.glassView.height;
    if (cw === 0 || ch === 0) return;
    const scale = cw / glass.width;
    glass.render(ctx, scale);

    const sel = glass.selected;
    if (sel) {
      ctx.setTransform(scale, 0, 0, scale, sel.x * scale, sel.y * scale);
      ctx.rotate(sel.rotation);
      ctx.scale(sel.scale, sel.scale);
      ctx.lineWidth = 1.5 / (scale * sel.scale);
      ctx.strokeStyle = '#ffd23f';
      ctx.strokeRect(-sel.w / 2, -sel.h / 2, sel.w, sel.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Rotation handle: a stalk from the top edge to a ring.
      const dpr = window.devicePixelRatio || 1;
      const cssPerGlass = this.glassView.clientWidth / glass.width;
      const h = handlePos(sel, 1 / cssPerGlass);
      const c = Math.cos(sel.rotation);
      const sn = Math.sin(sel.rotation);
      const top = -(sel.h / 2) * sel.scale;
      const tx = sel.x - sn * top;
      const ty = sel.y + c * top;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(tx * scale, ty * scale);
      ctx.lineTo(h.x * scale, h.y * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x * scale, h.y * scale, HANDLE_RADIUS_CSS * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#161616';
      ctx.fill();
      ctx.stroke();
    }

    if (scanner.state !== 'idle') {
      const p = scanner.barPos * scale;
      const vertical = scanner.direction === 'vertical';
      const dir = scanner.reverse ? -1 : 1;
      const glow = panel.get<number>('lampGlow');
      if (glow > 0 && scanner.scanning) {
        const lead = 90 * (window.devicePixelRatio || 1) * dir;
        const grad = vertical
          ? ctx.createLinearGradient(0, p, 0, p + lead)
          : ctx.createLinearGradient(p, 0, p + lead, 0);
        grad.addColorStop(0, `rgba(255, 225, 140, ${0.7 * glow})`);
        grad.addColorStop(1, 'rgba(255, 225, 140, 0)');
        ctx.fillStyle = grad;
        if (vertical) ctx.fillRect(0, Math.min(p, p + lead), cw, Math.abs(lead));
        else ctx.fillRect(Math.min(p, p + lead), 0, Math.abs(lead), ch);
      }
      ctx.fillStyle = scanner.scanning ? '#ffd23f' : 'rgba(255,210,63,0.5)';
      const t = Math.max(1, 1.5 * (window.devicePixelRatio || 1));
      if (vertical) ctx.fillRect(0, p - t / 2, cw, t);
      else ctx.fillRect(p - t / 2, 0, t, ch);
    }
  }

  private drawOutput(): void {
    const { scanner } = this.deps;
    const cw = this.outputView.width;
    const ch = this.outputView.height;
    if (cw === 0 || ch === 0) return;
    if (this.effects) {
      this.effects.render(scanner.output);
    } else if (this.octx) {
      this.octx.imageSmoothingEnabled = true;
      this.octx.drawImage(scanner.output, 0, 0, cw, ch);
    }
  }
}

// ---- helpers ----------------------------------------------------------

export function isMobile(): boolean {
  return window.matchMedia('(max-width: 800px)').matches;
}

function pane(id: string, caption: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'pane';
  el.id = id;
  const c = document.createElement('span');
  c.className = 'caption';
  c.textContent = caption;
  el.appendChild(c);
  return el;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function sep(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'sep';
  return s;
}

function spacer(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'spacer';
  return s;
}

/** Size a canvas to fit inside its pane at the given aspect, backing store at device pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, pane: HTMLElement, aspect: number): void {
  const cs = getComputedStyle(pane);
  const pw = pane.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ph = pane.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (pw <= 0 || ph <= 0) return;
  let w = pw;
  let h = pw / aspect;
  if (h > ph) {
    h = ph;
    w = ph * aspect;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
}
