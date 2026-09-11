// The scan head and the output buffer.
//
// Each tick, the bar advances some rows. The rows it covered since the last
// tick are copied from a fresh render of the glass into the output buffer at
// the same rows, and never touched again. That is the entire warp effect.
// Everything here is drawImage with source/dest rects; no per-pixel work.

import type { Glass, Transform, TransformMap } from './glass';
import { snapshotTransform } from './glass';

export type Direction = 'vertical' | 'horizontal';
export type ScanState = 'idle' | 'scanning' | 'done';
/** How a collage pass lands on top of the passes before it. */
export type Blend = 'over' | 'darken' | 'lighten';

const BLANK = '#8f8f8f';

const BLEND_OP: Record<Blend, GlobalCompositeOperation> = {
  over: 'source-over',
  darken: 'darken',
  lighten: 'lighten',
};

export class Scanner {
  readonly glass: Glass;
  readonly output: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private readonly sample: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D;

  width: number;
  height: number;
  direction: Direction = 'vertical';
  reverse = false;
  secondsPerPass = 8;
  /** Nominal dpi of the output; fidelity is expressed relative to it. */
  outputDpi = 300;
  /** Sample resolution of the scan head in dpi. Takes effect on the next pass. */
  fidelityDpi = 300;
  /** Sample px per output px for the pass in progress (<= 1). */
  private sampleScale = 1;
  /**
   * Exposure blur. A real head integrates light while it captures a row, so
   * a fast-moving page smears along its motion. 0 = point sample one
   * transform per frame, 1 = blend the whole frame-to-frame motion.
   */
  exposure = 0;
  private prev: TransformMap = new Map();

  /**
   * Collage mode. Passes stop clearing the output and stop painting the lid,
   * so each new pass lays its images over the ones already on the sheet.
   */
  persist = false;
  blend: Blend = 'darken';

  /** Pause the bar without ending the pass (the hold key). */
  hold = false;
  /** Sweep continuously, rewriting the output each pass, until captured. */
  loop = false;
  private captureNext = false;

  state: ScanState = 'idle';
  /** Rows (along the scan axis) the bar has travelled this pass, 0..length. */
  pos = 0;
  private written = 0;

  /** Called whenever the output buffer changed. */
  onChange: (() => void) | null = null;
  /** Called when a pass reaches the end. */
  onEnd: (() => void) | null = null;

  constructor(glass: Glass, width: number, height: number) {
    this.glass = glass;
    this.width = width;
    this.height = height;
    this.output = document.createElement('canvas');
    this.sample = document.createElement('canvas');
    this.octx = this.output.getContext('2d')!;
    this.sctx = this.sample.getContext('2d')!;
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.output.width = width;
    this.output.height = height;
    this.sampleScale = 1;
    this.sample.width = width;
    this.sample.height = height;
    this.state = 'idle';
    this.pos = 0;
    this.written = 0;
    this.clearOutput();
  }

  /** Length of the scan axis in output pixels. */
  get length(): number {
    return this.direction === 'vertical' ? this.height : this.width;
  }

  /** Where the bar is right now, as an output-space coordinate along the axis. */
  get barPos(): number {
    return this.reverse ? this.length - this.pos : this.pos;
  }

  get scanning(): boolean {
    return this.state === 'scanning';
  }

  start(): void {
    this.pos = 0;
    this.written = 0;
    this.captureNext = false;
    this.applyFidelity();
    if (!this.persist) this.clearOutput();
    this.state = 'scanning';
  }

  /** In loop mode: let the current pass finish, then freeze it. */
  capture(): void {
    this.captureNext = true;
  }

  private applyFidelity(): void {
    const s = Math.min(1, Math.max(0.02, this.fidelityDpi / this.outputDpi));
    if (s === this.sampleScale && this.sample.width > 0) return;
    this.sampleScale = s;
    this.sample.width = Math.max(1, Math.ceil(this.width * s));
    this.sample.height = Math.max(1, Math.ceil(this.height * s));
  }

  stop(): void {
    if (this.state === 'scanning') this.state = this.pos > 0 ? 'done' : 'idle';
  }

  /**
   * Start a fresh sheet. In collage mode the sheet is the lid colour, so a
   * darken stack builds on white and a lighten stack builds on black.
   */
  clear(): void {
    if (!this.persist) {
      this.clearOutput();
      return;
    }
    this.octx.setTransform(1, 0, 0, 1, 0, 0);
    this.octx.globalCompositeOperation = 'source-over';
    this.octx.fillStyle = this.glass.lidColor;
    this.octx.fillRect(0, 0, this.width, this.height);
    this.state = 'idle';
    this.pos = 0;
    this.written = 0;
    this.onChange?.();
  }

  private clearOutput(): void {
    this.octx.setTransform(1, 0, 0, 1, 0, 0);
    this.octx.fillStyle = BLANK;
    this.octx.fillRect(0, 0, this.width, this.height);
    this.onChange?.();
  }

  /** Advance the bar by dt milliseconds and freeze the rows it covered. */
  tick(dt: number): void {
    if (this.state !== 'scanning' || this.hold) {
      this.snapshot();
      return;
    }
    const len = this.length;
    const rate = len / Math.max(0.05, this.secondsPerPass); // rows per second
    this.pos = Math.min(len, this.pos + (dt / 1000) * rate);

    const to = Math.floor(this.pos);
    if (to > this.written) {
      this.copyStrip(this.written, to);
      this.written = to;
    }
    this.snapshot();

    if (this.pos >= len) {
      if (this.loop && !this.captureNext) {
        // Next pass overwrites the output row by row; nothing is cleared.
        this.pos = 0;
        this.written = 0;
      } else {
        this.state = 'done';
        this.captureNext = false;
        this.onEnd?.();
      }
    }
  }

  /** Remember where every image was this frame, for the next frame's exposure blur. */
  private snapshot(): void {
    this.prev.clear();
    for (const img of this.glass.images) this.prev.set(img.id, snapshotTransform(img));
  }

  /** True if any image moved since the last snapshot. */
  private moved(): boolean {
    for (const img of this.glass.images) {
      const p = this.prev.get(img.id);
      if (!p) continue;
      if (p.x !== img.x || p.y !== img.y || p.scale !== img.scale || p.rotation !== img.rotation) return true;
    }
    return false;
  }

  /** Transforms interpolated between the previous frame (t=0) and now (t=1). */
  private between(t: number): TransformMap {
    const m: TransformMap = new Map();
    for (const img of this.glass.images) {
      const p = this.prev.get(img.id);
      if (!p) continue;
      const tr: Transform = {
        x: p.x + (img.x - p.x) * t,
        y: p.y + (img.y - p.y) * t,
        scale: p.scale + (img.scale - p.scale) * t,
        rotation: p.rotation + (img.rotation - p.rotation) * t,
      };
      m.set(img.id, tr);
    }
    return m;
  }

  /** Render the glass into the sample canvas, blending sub-frames when exposure is on. */
  private renderSample(k: number): void {
    const s = this.sctx;
    if (this.exposure <= 0 || !this.moved()) {
      this.glass.render(s, k, undefined, this.persist);
      return;
    }
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t = 1 - this.exposure * (1 - i / (n - 1));
      // Drawing layer i with alpha 1/(i+1) leaves an equal-weight average.
      s.globalAlpha = 1 / (i + 1);
      this.glass.render(s, k, this.between(t), this.persist);
    }
    s.globalAlpha = 1;
  }

  /** Copy axis rows [from, to) of the current glass into the output. */
  private copyStrip(from: number, to: number): void {
    const len = this.length;
    // Map pass-relative rows to output rows.
    const a = this.reverse ? len - to : from;
    const b = this.reverse ? len - from : to;
    const vertical = this.direction === 'vertical';
    const x = vertical ? 0 : a;
    const y = vertical ? a : 0;
    const w = vertical ? this.width : b - a;
    const h = vertical ? b - a : this.height;

    // Render only the strip we need from the glass, at the head's sample
    // resolution, then copy it up into the output (nearest-neighbour when
    // the head is coarser than the page, like a real low-res scan).
    const k = this.sampleScale;
    const s = this.sctx;
    const rx = Math.floor(x * k) - 1;
    const ry = Math.floor(y * k) - 1;
    const rw = Math.ceil(w * k) + 2;
    const rh = Math.ceil(h * k) + 2;
    s.save();
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.beginPath();
    s.rect(rx, ry, rw, rh);
    s.clip();
    // A collage pass paints no lid, so the previous frame's strip has to be
    // wiped by hand instead of being covered over.
    if (this.persist) s.clearRect(rx, ry, rw, rh);
    this.renderSample(k);
    s.restore();

    this.octx.imageSmoothingEnabled = k >= 1;
    this.octx.globalCompositeOperation = this.persist ? BLEND_OP[this.blend] : 'source-over';
    this.octx.drawImage(this.sample, x * k, y * k, w * k, h * k, x, y, w, h);
    this.octx.globalCompositeOperation = 'source-over';
    this.onChange?.();
  }
}
