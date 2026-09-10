// The glass: every placed image and how to render them at any scale.
// All coordinates are in output-resolution pixels ("glass px").

export interface Transform {
  x: number;        // centre of the image on the glass
  y: number;
  scale: number;    // 1 = native pixels
  rotation: number; // radians, clockwise
}

export interface GlassImage extends Transform {
  id: number;
  bitmap: ImageBitmap;
  w: number; // natural size
  h: number;
  z: number;
}

/** Per-image transform overrides, used by the scanner for exposure blur. */
export type TransformMap = Map<number, Transform>;

export class Glass {
  width: number;
  height: number;
  lidClosed = true;
  images: GlassImage[] = [];
  selectedId: number | null = null;
  private nextId = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  get lidColor(): string {
    return this.lidClosed ? '#ffffff' : '#000000';
  }

  resize(width: number, height: number): void {
    const sx = width / this.width;
    const sy = height / this.height;
    this.width = width;
    this.height = height;
    // Keep images at the same relative position on the new glass.
    for (const img of this.images) {
      img.x *= sx;
      img.y *= sy;
    }
  }

  /** Place a bitmap centred on the glass at native size, or scaled down to fit if it is bigger. */
  addImage(bitmap: ImageBitmap): GlassImage {
    const w = bitmap.width;
    const h = bitmap.height;
    const fit = Math.min(1, (this.width * 0.9) / w, (this.height * 0.9) / h);
    const img: GlassImage = {
      id: this.nextId++,
      bitmap,
      w,
      h,
      x: this.width / 2,
      y: this.height / 2,
      scale: fit,
      rotation: 0,
      z: this.topZ() + 1,
    };
    this.images.push(img);
    this.selectedId = img.id;
    return img;
  }

  get selected(): GlassImage | null {
    return this.images.find((i) => i.id === this.selectedId) ?? null;
  }

  byId(id: number): GlassImage | null {
    return this.images.find((i) => i.id === id) ?? null;
  }

  /** Images in draw order (lowest z first). */
  sorted(): GlassImage[] {
    return [...this.images].sort((a, b) => a.z - b.z);
  }

  private topZ(): number {
    return this.images.reduce((m, i) => Math.max(m, i.z), 0);
  }

  /** Topmost image whose (rotated, scaled) bounds contain the glass point. */
  hitTest(x: number, y: number): GlassImage | null {
    const order = this.sorted();
    for (let i = order.length - 1; i >= 0; i--) {
      const img = order[i];
      const p = toLocal(img, x, y);
      if (Math.abs(p.x) <= img.w / 2 && Math.abs(p.y) <= img.h / 2) return img;
    }
    return null;
  }

  remove(id: number): void {
    this.images = this.images.filter((i) => i.id !== id);
    if (this.selectedId === id) this.selectedId = null;
  }

  bringForward(id: number): void {
    const img = this.byId(id);
    if (img) img.z = this.topZ() + 1;
  }

  sendBack(id: number): void {
    const img = this.byId(id);
    if (!img) return;
    const minZ = this.images.reduce((m, i) => Math.min(m, i.z), Infinity);
    img.z = minZ - 1;
  }

  /**
   * Draw the whole glass into ctx, scaled by `scale` (1 = output resolution).
   * The caller owns the context state; this overwrites the transform.
   */
  render(ctx: CanvasRenderingContext2D, scale: number, overrides?: TransformMap): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.lidColor;
    ctx.fillRect(0, 0, this.width * scale, this.height * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const img of this.sorted()) {
      const t = overrides?.get(img.id) ?? img;
      ctx.setTransform(scale, 0, 0, scale, t.x * scale, t.y * scale);
      ctx.rotate(t.rotation);
      ctx.scale(t.scale, t.scale);
      ctx.drawImage(img.bitmap, -img.w / 2, -img.h / 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Map a glass point into an image's local, unscaled, unrotated pixel space. */
export function toLocal(img: Transform, x: number, y: number): { x: number; y: number } {
  const dx = x - img.x;
  const dy = y - img.y;
  const c = Math.cos(-img.rotation);
  const s = Math.sin(-img.rotation);
  return { x: (dx * c - dy * s) / img.scale, y: (dx * s + dy * c) / img.scale };
}

export function snapshotTransform(img: Transform): Transform {
  return { x: img.x, y: img.y, scale: img.scale, rotation: img.rotation };
}
