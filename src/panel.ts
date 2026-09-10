// The control panel: one flat state object, a declarative list of controls,
// and modes that are JSON snapshots of that object plus a name.

export type Group = 'Scan' | 'Light' | 'Tone' | 'Texture' | 'Paper';

interface Base {
  id: string;
  label: string;
  group: Group;
  /** Id of the stage toggle this control belongs to; dimmed when the stage is off. */
  stage?: string;
  help?: string;
}

export type Control =
  | (Base & { type: 'range'; min: number; max: number; step: number; default: number; unit?: string })
  | (Base & { type: 'select'; options: { value: number; label: string }[]; default: number })
  | (Base & { type: 'seed'; default: number })
  | (Base & { type: 'stage'; default: boolean });

export type PanelState = Record<string, number | boolean>;

export const CONTROLS: Control[] = [
  // Scan — the loop reads these; they take effect on the next pass.
  { id: 'speed', label: 'Speed', group: 'Scan', type: 'range', min: 0.5, max: 60, step: 0.5, default: 8, unit: 's/pass' },
  { id: 'exposure', label: 'Exposure', group: 'Scan', type: 'range', min: 0, max: 1, step: 0.01, default: 0, help: 'Motion blur while a row is captured. 0 = point sample, 1 = full frame-to-frame smear.' },
  { id: 'fidelity', label: 'Fidelity', group: 'Scan', type: 'range', min: 25, max: 600, step: 5, default: 300, unit: 'dpi', help: 'Sample resolution of the scan head. Next pass.' },

  // Light.
  { id: 'bleedOn', label: 'Light bleed', group: 'Light', type: 'stage', default: false },
  { id: 'bleedSpread', label: 'Spread', group: 'Light', stage: 'bleedOn', type: 'range', min: 1, max: 64, step: 1, default: 12, unit: 'px' },
  { id: 'bleedIntensity', label: 'Intensity', group: 'Light', stage: 'bleedOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
  { id: 'leakOn', label: 'Lid leak', group: 'Light', type: 'stage', default: false },
  { id: 'leakReach', label: 'Reach', group: 'Light', stage: 'leakOn', type: 'range', min: 0, max: 1200, step: 10, default: 250, unit: 'px', help: 'Only with the lid open.' },
  { id: 'lampGlow', label: 'Lamp glow', group: 'Light', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Cosmetic, glass view only.' },

  // Tone.
  { id: 'levelsOn', label: 'Levels', group: 'Tone', type: 'stage', default: true },
  { id: 'black', label: 'Black point', group: 'Tone', stage: 'levelsOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
  { id: 'white', label: 'White point', group: 'Tone', stage: 'levelsOn', type: 'range', min: 0, max: 1, step: 0.01, default: 1 },
  { id: 'gamma', label: 'Gamma', group: 'Tone', stage: 'levelsOn', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1 },
  { id: 'threshOn', label: 'Threshold', group: 'Tone', type: 'stage', default: false },
  { id: 'thresh', label: 'Level', group: 'Tone', stage: 'threshOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { id: 'threshSoft', label: 'Softness', group: 'Tone', stage: 'threshOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
  { id: 'dither', label: 'Dither', group: 'Tone', type: 'select', default: 0, options: [
    { value: 0, label: 'none' }, { value: 1, label: 'Bayer 4×4' }, { value: 2, label: 'Bayer 8×8' }, { value: 3, label: 'halftone' },
  ] },
  { id: 'ditherCell', label: 'Cell', group: 'Tone', type: 'range', min: 2, max: 32, step: 1, default: 8, unit: 'px', help: 'Halftone only.' },
  { id: 'ditherAngle', label: 'Angle', group: 'Tone', type: 'range', min: 0, max: 90, step: 1, default: 45, unit: '°', help: 'Halftone only.' },
  { id: 'genLoss', label: 'Generations', group: 'Tone', type: 'range', min: 0, max: 5, step: 1, default: 0, help: 'Copy of a copy: blur then threshold again, this many times.' },

  // Texture.
  { id: 'grainOn', label: 'Grain', group: 'Texture', type: 'stage', default: false },
  { id: 'grain', label: 'Amount', group: 'Texture', stage: 'grainOn', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.25 },
  { id: 'grainSize', label: 'Size', group: 'Texture', stage: 'grainOn', type: 'range', min: 1, max: 8, step: 1, default: 1, unit: 'px' },
  { id: 'roughOn', label: 'Edge roughness', group: 'Texture', type: 'stage', default: false },
  { id: 'rough', label: 'Amount', group: 'Texture', stage: 'roughOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25, help: 'Only visible with threshold or dither on.' },
  { id: 'jitterOn', label: 'Line jitter', group: 'Texture', type: 'stage', default: false },
  { id: 'jitter', label: 'Amount', group: 'Texture', stage: 'jitterOn', type: 'range', min: 0, max: 0.5, step: 0.005, default: 0.06 },
  { id: 'streakOn', label: 'Toner streaks', group: 'Texture', type: 'stage', default: false },
  { id: 'streak', label: 'Amount', group: 'Texture', stage: 'streakOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25 },
  { id: 'streakWidth', label: 'Width', group: 'Texture', stage: 'streakOn', type: 'range', min: 4, max: 400, step: 1, default: 60, unit: 'px' },
  { id: 'dropOn', label: 'Dropout', group: 'Texture', type: 'stage', default: false },
  { id: 'dropout', label: 'Density', group: 'Texture', stage: 'dropOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2 },
  { id: 'seed', label: 'Seed', group: 'Texture', type: 'seed', default: 1 },

  // Paper.
  { id: 'paperOn', label: 'Paper', group: 'Paper', type: 'stage', default: false },
  { id: 'tint', label: 'Tint', group: 'Paper', stage: 'paperOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
  { id: 'vignette', label: 'Vignette', group: 'Paper', stage: 'paperOn', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
];

export const GROUPS: Group[] = ['Scan', 'Light', 'Tone', 'Texture', 'Paper'];

export interface Mode {
  name: string;
  values: Partial<PanelState>;
  builtin?: boolean;
}

export const MODES: Mode[] = [
  { name: 'Manual', builtin: true, values: {} },
  { name: 'Early copier', builtin: true, values: {
    fidelity: 150, speed: 10, exposure: 0.35,
    black: 0.1, white: 0.9, gamma: 1,
    threshOn: true, thresh: 0.5, threshSoft: 0,
    roughOn: true, rough: 0.35,
    bleedOn: true, bleedSpread: 6, bleedIntensity: 0.15,
  } },
  { name: '90s office laser', builtin: true, values: {
    fidelity: 300, speed: 8,
    black: 0.08, white: 0.92, gamma: 1.05,
    threshOn: true, thresh: 0.5, threshSoft: 0.15,
    dither: 1,
    roughOn: true, rough: 0.12,
    streakOn: true, streak: 0.1, streakWidth: 40,
    dropOn: true, dropout: 0.25,
  } },
  { name: 'Fax', builtin: true, values: {
    fidelity: 100, speed: 20,
    black: 0.15, white: 0.85,
    threshOn: true, thresh: 0.5, threshSoft: 0,
    roughOn: true, rough: 0.3,
    jitterOn: true, jitter: 0.2,
    dropOn: true, dropout: 0.45,
  } },
  { name: 'Flatbed CCD', builtin: true, values: {
    fidelity: 400, speed: 8, exposure: 0.7,
    black: 0.12, white: 0.82, gamma: 0.9,
    grainOn: true, grain: 0.55, grainSize: 1,
    jitterOn: true, jitter: 0.08,
    streakOn: true, streak: 0.12, streakWidth: 80,
  } },
  { name: 'Generation loss', builtin: true, values: {
    fidelity: 200, speed: 8,
    black: 0.1, white: 0.9,
    threshOn: true, thresh: 0.5, threshSoft: 0.1,
    roughOn: true, rough: 0.2,
    genLoss: 2,
    dropOn: true, dropout: 0.2,
  } },
];

export function defaults(): PanelState {
  const s: PanelState = {};
  for (const c of CONTROLS) s[c.id] = c.default;
  return s;
}

export function applyMode(mode: Mode): PanelState {
  return { ...defaults(), ...(mode.values as PanelState) };
}

export function sameValues(a: PanelState, b: PanelState): boolean {
  for (const c of CONTROLS) if (a[c.id] !== b[c.id]) return false;
  return true;
}

const STORAGE_STATE = 'vscan.state';
const STORAGE_MODES = 'vscan.modes';
const STORAGE_MODE_NAME = 'vscan.mode';

export interface PanelEvents {
  onChange: (id: string) => void;
}

export class Panel {
  readonly root: HTMLElement;
  state: PanelState;
  modes: Mode[];
  modeName: string;
  private readonly events: PanelEvents;
  private readonly rows = new Map<string, { row: HTMLElement; update: () => void }>();
  private modeSelect!: HTMLSelectElement;
  private modeDot!: HTMLElement;

  constructor(root: HTMLElement, events: PanelEvents) {
    this.root = root;
    this.events = events;
    this.modes = [...MODES, ...loadCustomModes()];
    this.modeName = localStorage.getItem(STORAGE_MODE_NAME) ?? 'Manual';
    this.state = { ...defaults(), ...loadJSON<PanelState>(STORAGE_STATE) };
    if (!this.modes.some((m) => m.name === this.modeName)) this.modeName = 'Manual';
    this.build();
    this.refresh();
  }

  get<T extends number | boolean>(id: string): T {
    return this.state[id] as T;
  }

  set(id: string, value: number | boolean, silent = false): void {
    if (this.state[id] === value) return;
    this.state[id] = value;
    this.rows.get(id)?.update();
    this.refreshStages();
    this.refreshModeDot();
    this.persist();
    if (!silent) this.events.onChange(id);
  }

  /** Replace the whole state (mode change, import). */
  load(state: PanelState, modeName?: string): void {
    this.state = { ...defaults(), ...state };
    if (modeName) this.modeName = modeName;
    this.refresh();
    this.persist();
    this.events.onChange('*');
  }

  selectMode(name: string): void {
    const m = this.modes.find((x) => x.name === name);
    if (!m) return;
    this.load(applyMode(m), name);
  }

  saveAs(name: string): void {
    name = name.trim();
    if (!name) return;
    const values: Partial<PanelState> = {};
    const d = defaults();
    for (const c of CONTROLS) if (this.state[c.id] !== d[c.id]) values[c.id] = this.state[c.id];
    this.modes = this.modes.filter((m) => m.name !== name || m.builtin);
    if (this.modes.some((m) => m.name === name && m.builtin)) name = `${name} (custom)`;
    this.modes.push({ name, values });
    this.modeName = name;
    this.persist();
    this.refresh();
  }

  deleteMode(name: string): void {
    const m = this.modes.find((x) => x.name === name);
    if (!m || m.builtin) return;
    this.modes = this.modes.filter((x) => x !== m);
    if (this.modeName === name) this.modeName = 'Manual';
    this.persist();
    this.refresh();
  }

  private currentMode(): Mode | undefined {
    return this.modes.find((m) => m.name === this.modeName);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_STATE, JSON.stringify(this.state));
      localStorage.setItem(STORAGE_MODE_NAME, this.modeName);
      localStorage.setItem(STORAGE_MODES, JSON.stringify(this.modes.filter((m) => !m.builtin)));
    } catch {
      // Storage may be unavailable; the app still works without it.
    }
  }

  // ---- DOM ------------------------------------------------------------

  private build(): void {
    const root = this.root;
    root.innerHTML = '';

    const head = el('div', 'panel-head');
    this.modeSelect = document.createElement('select');
    this.modeSelect.addEventListener('change', () => this.selectMode(this.modeSelect.value));
    this.modeDot = el('span', 'mode-dot');
    this.modeDot.title = 'modified from the mode';
    const saveBtn = btn('Save as', () => {
      const name = window.prompt('Mode name', this.currentMode()?.builtin ? '' : this.modeName);
      if (name) this.saveAs(name);
    });
    const delBtn = btn('Delete', () => this.deleteMode(this.modeName));
    delBtn.className = 'mode-delete';
    head.append(this.modeSelect, this.modeDot, saveBtn, delBtn);
    root.appendChild(head);
    this.modeDelete = delBtn;

    for (const g of GROUPS) {
      const section = el('section', 'group');
      const h = el('h3');
      h.textContent = g;
      section.appendChild(h);
      for (const c of CONTROLS.filter((x) => x.group === g)) section.appendChild(this.buildRow(c));
      root.appendChild(section);
    }
  }

  private modeDelete!: HTMLButtonElement;

  private buildRow(c: Control): HTMLElement {
    const row = el('div', `row row-${c.type}`);
    if (c.stage) row.dataset.stage = c.stage;
    const lab = el('label');
    lab.textContent = c.label;
    if (c.help) lab.title = c.help;
    row.appendChild(lab);

    let update: () => void = () => {};
    if (c.type === 'range') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = String(c.step);
      const num = document.createElement('input');
      num.type = 'number';
      num.min = input.min;
      num.max = input.max;
      num.step = input.step;
      input.addEventListener('input', () => this.set(c.id, Number(input.value)));
      num.addEventListener('change', () => this.set(c.id, clamp(Number(num.value), c.min, c.max)));
      input.addEventListener('dblclick', () => this.set(c.id, c.default));
      row.append(input, num);
      if (c.unit) {
        const u = el('span', 'unit');
        u.textContent = c.unit;
        row.appendChild(u);
      }
      update = () => {
        const v = Number(this.state[c.id]);
        input.value = String(v);
        num.value = String(round(v, c.step));
      };
    } else if (c.type === 'select') {
      const sel = document.createElement('select');
      for (const o of c.options) {
        const opt = document.createElement('option');
        opt.value = String(o.value);
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => this.set(c.id, Number(sel.value)));
      row.appendChild(sel);
      update = () => { sel.value = String(this.state[c.id]); };
    } else if (c.type === 'seed') {
      const num = document.createElement('input');
      num.type = 'number';
      num.step = '1';
      num.addEventListener('change', () => this.set(c.id, Math.floor(Number(num.value) || 0)));
      const reroll = btn('Reroll', () => this.set(c.id, Math.floor(Math.random() * 1e6)));
      row.append(num, reroll);
      update = () => { num.value = String(this.state[c.id]); };
    } else {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => this.set(c.id, cb.checked));
      lab.prepend(cb);
      row.classList.add('stage');
      update = () => { cb.checked = Boolean(this.state[c.id]); };
    }
    this.rows.set(c.id, { row, update });
    return row;
  }

  private refresh(): void {
    this.modeSelect.innerHTML = '';
    for (const m of this.modes) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      this.modeSelect.appendChild(opt);
    }
    this.modeSelect.value = this.modeName;
    this.modeDelete.hidden = this.currentMode()?.builtin !== false;
    for (const r of this.rows.values()) r.update();
    this.refreshStages();
    this.refreshModeDot();
  }

  private refreshStages(): void {
    for (const [, r] of this.rows) {
      const stage = r.row.dataset.stage;
      if (stage) r.row.classList.toggle('off', !this.state[stage]);
    }
  }

  private refreshModeDot(): void {
    const m = this.currentMode();
    const modified = m ? !sameValues(this.state, applyMode(m)) : true;
    this.modeDot.classList.toggle('on', modified);
  }
}

// ---- helpers -----------------------------------------------------------

function loadCustomModes(): Mode[] {
  const arr = loadJSON<Mode[]>(STORAGE_MODES);
  if (!Array.isArray(arr)) return [];
  return arr.filter((m) => m && typeof m.name === 'string' && typeof m.values === 'object').map((m) => ({ name: m.name, values: m.values }));
}

function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function btn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

function round(v: number, step: number): number {
  const d = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(v.toFixed(d));
}
