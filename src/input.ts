// Pointer and gesture input on the glass view. One code path for mouse,
// touch and pen via Pointer Events. Screen coordinates are mapped into glass
// (output-resolution) coordinates through screenToGlass and nothing else.
//
// Pointer input is deliberately not smoothed: hand jitter is part of the look.

import type { Glass, GlassImage } from './glass';
import { toLocal } from './glass';

interface Pointer {
  x: number;
  y: number;
}

interface Drag {
  img: GlassImage;
  mode: 'move' | 'rotate';
  offX: number;
  offY: number;
  startAngle: number;
  startRot: number;
}

interface Pinch {
  img: GlassImage;
  ids: [number, number];
  d0: number;
  a0: number;
  mid0: Pointer;
  x0: number;
  y0: number;
  s0: number;
  r0: number;
}

export interface InputEvents {
  /** An image transform changed (drag in progress). */
  onChange: () => void;
  /** A gesture finished; a good moment to record undo state. */
  onGestureEnd: () => void;
  /** The selection changed. */
  onSelect: () => void;
}

const MIN_SCALE = 0.01;
const MAX_SCALE = 64;
/** Distance of the rotation handle above the image's top edge, in CSS px. */
export const HANDLE_OFFSET_CSS = 28;
export const HANDLE_RADIUS_CSS = 9;

/** Glass position of the rotation handle for an image. */
export function handlePos(img: GlassImage, glassPerCss: number): Pointer {
  const up = -(img.h / 2) * img.scale - HANDLE_OFFSET_CSS * glassPerCss;
  const c = Math.cos(img.rotation);
  const s = Math.sin(img.rotation);
  return { x: img.x - s * up, y: img.y + c * up };
}

export class Input {
  private readonly canvas: HTMLCanvasElement;
  private readonly glass: Glass;
  private readonly events: InputEvents;
  private pointers = new Map<number, Pointer>();
  private drag: Drag | null = null;
  private pinch: Pinch | null = null;
  private wheelTimer = 0;

  constructor(canvas: HTMLCanvasElement, glass: Glass, events: InputEvents) {
    this.canvas = canvas;
    this.glass = glass;
    this.events = events;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The one place screen coordinates become glass coordinates. */
  screenToGlass(clientX: number, clientY: number): Pointer {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.glass.width,
      y: ((clientY - r.top) / r.height) * this.glass.height,
    };
  }

  /** Glass px per CSS px, for sizing hit targets that should feel constant on screen. */
  glassPerCss(): number {
    const r = this.canvas.getBoundingClientRect();
    return this.glass.width / Math.max(1, r.width);
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.screenToGlass(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2) {
      this.beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    // The rotation handle of the selected image sits on top of everything.
    const sel = this.glass.selected;
    if (sel) {
      const h = handlePos(sel, this.glassPerCss());
      const r = (HANDLE_RADIUS_CSS + 6) * this.glassPerCss();
      if (Math.hypot(p.x - h.x, p.y - h.y) <= r) {
        this.drag = {
          img: sel,
          mode: 'rotate',
          offX: 0,
          offY: 0,
          startAngle: Math.atan2(p.y - sel.y, p.x - sel.x),
          startRot: sel.rotation,
        };
        return;
      }
    }

    const img = this.glass.hitTest(p.x, p.y);
    if (img && img.id !== this.glass.selectedId) {
      this.glass.selectedId = img.id;
      this.events.onSelect();
    } else if (!img && this.glass.selectedId !== null) {
      this.glass.selectedId = null;
      this.events.onSelect();
    }
    if (!img) return;

    if (e.shiftKey) {
      this.drag = {
        img,
        mode: 'rotate',
        offX: 0,
        offY: 0,
        startAngle: Math.atan2(p.y - img.y, p.x - img.x),
        startRot: img.rotation,
      };
    } else {
      this.drag = { img, mode: 'move', offX: p.x - img.x, offY: p.y - img.y, startAngle: 0, startRot: 0 };
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.screenToGlass(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, p);

    if (this.pinch) {
      this.updatePinch();
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'move') {
      d.img.x = p.x - d.offX;
      d.img.y = p.y - d.offY;
    } else {
      const a = Math.atan2(p.y - d.img.y, p.x - d.img.x);
      d.img.rotation = d.startRot + (a - d.startAngle);
    }
    this.events.onChange();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const hadGesture = this.drag !== null || this.pinch !== null;
    if (this.pinch) {
      // Pinch ends when either finger lifts; the other finger does nothing further.
      this.pinch = null;
      this.drag = null;
    } else if (this.pointers.size === 0) {
      this.drag = null;
    }
    if (hadGesture && this.pointers.size === 0) this.events.onGestureEnd();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.screenToGlass(e.clientX, e.clientY);
    const img = this.glass.hitTest(p.x, p.y) ?? this.glass.selected;
    if (!img) return;
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    img.scale = clamp(img.scale * factor, MIN_SCALE, MAX_SCALE);
    this.events.onChange();
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => this.events.onGestureEnd(), 250);
  };

  private beginPinch(): void {
    const [a, b] = [...this.pointers.entries()];
    const mid = { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 };
    const img = this.drag?.img ?? this.glass.hitTest(mid.x, mid.y) ?? this.glass.selected;
    this.drag = null;
    if (!img) return;
    if (img.id !== this.glass.selectedId) {
      this.glass.selectedId = img.id;
      this.events.onSelect();
    }
    this.pinch = {
      img,
      ids: [a[0], b[0]],
      d0: Math.max(1, Math.hypot(b[1].x - a[1].x, b[1].y - a[1].y)),
      a0: Math.atan2(b[1].y - a[1].y, b[1].x - a[1].x),
      mid0: mid,
      x0: img.x,
      y0: img.y,
      s0: img.scale,
      r0: img.rotation,
    };
  }

  private updatePinch(): void {
    const g = this.pinch!;
    const a = this.pointers.get(g.ids[0]);
    const b = this.pointers.get(g.ids[1]);
    if (!a || !b) return;
    const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    g.img.scale = clamp(g.s0 * (d / g.d0), MIN_SCALE, MAX_SCALE);
    g.img.rotation = g.r0 + (ang - g.a0);
    g.img.x = g.x0 + (mid.x - g.mid0.x);
    g.img.y = g.y0 + (mid.y - g.mid0.y);
    this.events.onChange();
  }
}

/** True when the glass point lies inside the image. Exported for UI hit-testing. */
export function inside(img: GlassImage, x: number, y: number): boolean {
  const p = toLocal(img, x, y);
  return Math.abs(p.x) <= img.w / 2 && Math.abs(p.y) <= img.h / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
