// Everything on screen that is not the glass, the scan loop or the input
// mapping: toolbar, panes, file loading, view drawing and saving.

import type { Glass } from './glass';
import type { Scanner } from './scanner';

export interface UIDeps {
  glass: Glass;
  scanner: Scanner;
  onImagesChanged: () => void;
}

export class UI {
  readonly root: HTMLElement;
  readonly glassView: HTMLCanvasElement;
  readonly outputView: HTMLCanvasElement;
  private readonly glassPane: HTMLElement;
  private readonly outputPane: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly gctx: CanvasRenderingContext2D;
  private readonly octx: CanvasRenderingContext2D;
  private readonly deps: UIDeps;
  private scanBtn!: HTMLButtonElement;
  private lidBtn!: HTMLButtonElement;
  private dirBtn!: HTMLButtonElement;
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
    main.append(this.glassPane, this.outputPane);
    root.appendChild(main);

    this.gctx = this.glassView.getContext('2d')!;
    this.octx = this.outputView.getContext('2d')!;

    deps.scanner.onChange = () => { this.outputDirty = true; };
    deps.scanner.onEnd = () => this.syncButtons();

    window.addEventListener('resize', () => this.layout());
    this.setupFileLoading();
    this.applyMobileTab();
    this.layout();
    this.syncButtons();
  }

  // ---- toolbar -------------------------------------------------------

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('header');
    bar.className = 'toolbar';

    const open = button('Open', () => this.pickFile());
    this.lidBtn = button('', () => {
      this.deps.glass.lidClosed = !this.deps.glass.lidClosed;
      this.syncButtons();
    });
    this.dirBtn = button('', () => {
      const s = this.deps.scanner;
      s.direction = s.direction === 'vertical' ? 'horizontal' : 'vertical';
      this.syncButtons();
    });

    const speed = document.createElement('input');
    speed.type = 'number';
    speed.min = '0.5';
    speed.max = '120';
    speed.step = '0.5';
    speed.value = String(this.deps.scanner.secondsPerPass);
    speed.addEventListener('change', () => {
      this.deps.scanner.secondsPerPass = Math.max(0.5, Number(speed.value) || 8);
    });
    const speedLabel = label('speed', speed, 's/pass');

    this.scanBtn = button('Scan', () => this.toggleScan());
    this.scanBtn.classList.add('primary');
    const save = button('Save PNG', () => this.savePng());

    const tabs = document.createElement('span');
    tabs.className = 'tabs';
    const tabGlass = button('Glass', () => this.setMobileTab('glass'));
    const tabOut = button('Output', () => this.setMobileTab('output'));
    tabs.append(tabGlass, tabOut);
    this.tabButtons = [tabGlass, tabOut];

    bar.append(open, sep(), this.lidBtn, this.dirBtn, speedLabel, sep(), this.scanBtn, save, spacer(), tabs);
    return bar;
  }

  private tabButtons: HTMLButtonElement[] = [];

  syncButtons(): void {
    const { glass, scanner } = this.deps;
    this.lidBtn.textContent = glass.lidClosed ? 'Lid: closed' : 'Lid: open';
    this.dirBtn.textContent = scanner.direction === 'vertical' ? 'Sweep: down' : 'Sweep: right';
    this.scanBtn.textContent = scanner.scanning ? 'Stop' : 'Scan';
    this.scanBtn.classList.toggle('primary', !scanner.scanning);
    this.tabButtons[0]?.classList.toggle('on', this.mobileTab === 'glass');
    this.tabButtons[1]?.classList.toggle('on', this.mobileTab === 'output');
  }

  toggleScan(): void {
    const s = this.deps.scanner;
    if (s.scanning) s.stop();
    else {
      s.start();
      if (window.innerWidth <= 800) this.setMobileTab('output');
    }
    this.syncButtons();
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
  }

  savePng(): void {
    const { scanner } = this.deps;
    scanner.output.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scan-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, 'image/png');
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
    if (this.outputDirty) {
      this.drawOutput();
      this.outputDirty = false;
    }
  }

  private drawGlass(): void {
    const { glass, scanner } = this.deps;
    const ctx = this.gctx;
    const cw = this.glassView.width;
    const ch = this.glassView.height;
    if (cw === 0 || ch === 0) return;
    const scale = cw / glass.width;
    glass.render(ctx, scale);

    // Selection outline.
    const sel = glass.selected;
    if (sel) {
      ctx.setTransform(scale, 0, 0, scale, sel.x * scale, sel.y * scale);
      ctx.rotate(sel.rotation);
      ctx.scale(sel.scale, sel.scale);
      ctx.lineWidth = 1.5 / (scale * sel.scale);
      ctx.strokeStyle = '#ffd23f';
      ctx.strokeRect(-sel.w / 2, -sel.h / 2, sel.w, sel.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // The bar.
    if (scanner.state !== 'idle') {
      const p = scanner.barPos * scale;
      const vertical = scanner.direction === 'vertical';
      const dir = scanner.reverse ? -1 : 1;
      const lead = 40 * (window.devicePixelRatio || 1) * dir;
      const grad = vertical
        ? ctx.createLinearGradient(0, p, 0, p + lead)
        : ctx.createLinearGradient(p, 0, p + lead, 0);
      grad.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
      grad.addColorStop(1, 'rgba(255, 220, 120, 0)');
      ctx.fillStyle = grad;
      if (vertical) ctx.fillRect(0, Math.min(p, p + lead), cw, Math.abs(lead));
      else ctx.fillRect(Math.min(p, p + lead), 0, Math.abs(lead), ch);
      ctx.fillStyle = scanner.scanning ? '#ffd23f' : 'rgba(255,210,63,0.5)';
      const t = Math.max(1, 1.5 * (window.devicePixelRatio || 1));
      if (vertical) ctx.fillRect(0, p - t / 2, cw, t);
      else ctx.fillRect(p - t / 2, 0, t, ch);
    }
  }

  private drawOutput(): void {
    const { scanner } = this.deps;
    const ctx = this.octx;
    const cw = this.outputView.width;
    const ch = this.outputView.height;
    if (cw === 0 || ch === 0) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scanner.output, 0, 0, cw, ch);
  }
}

// ---- helpers ----------------------------------------------------------

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

function label(text: string, el: HTMLElement, suffix?: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.append(text, el);
  if (suffix) l.append(suffix);
  return l;
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
