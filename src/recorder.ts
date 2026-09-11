// Records the output while a pass runs, holds on the finished scan for a
// few seconds, and hands back a file.
//
// Frames are blitted into a plain 2D canvas rather than captured from the
// WebGL canvas directly. captureStream on a WebGL surface depends on the
// drawing buffer still being valid, and it is not once the browser has
// composited the frame. The caller blits in the same synchronous block as
// the render, which always holds.

// Bare 'video/mp4' is deliberately absent. Browsers report it as supported
// and then pick whatever encoder they have, which on some builds is VP9 in
// an MP4 container: technically legal, rejected by most players and upload
// pipelines. Ask for H.264 by name or take a well-formed WebM instead.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.4d002a',
  'video/mp4;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

const FPS = 30;
/** Longest edge of the recorded video. */
const MAX_EDGE = 1080;
/** Still frames held on the finished scan at the end of the clip. */
const HOLD_MS = 5000;

export type RecorderState = 'idle' | 'recording' | 'holding';

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

/** True when this browser can record a canvas at all. */
export function videoSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickMime() !== null
  );
}

export class Recorder {
  /** Armed by the user; the next pass records. */
  armed = false;
  state: RecorderState = 'idle';

  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  /** The final scan frame, re-stamped for the length of the hold. */
  private readonly still = document.createElement('canvas');
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private holdTimer = 0;
  private mime = '';

  /** Called when a clip finishes saving, or fails. */
  onDone: ((err?: Error) => void) | null = null;

  get active(): boolean {
    return this.state !== 'idle';
  }

  /** Size the capture surface to the output aspect and start recording. */
  begin(outW: number, outH: number): boolean {
    if (this.active) return false;
    const mime = pickMime();
    if (!mime || outW <= 0 || outH <= 0) return false;
    this.mime = mime;

    const k = Math.min(1, MAX_EDGE / Math.max(outW, outH));
    // Encoders reject odd dimensions, so round both edges to even numbers.
    this.canvas.width = Math.max(2, Math.round((outW * k) / 2) * 2);
    this.canvas.height = Math.max(2, Math.round((outH * k) / 2) * 2);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    try {
      const stream = this.canvas.captureStream(FPS);
      this.rec = new MediaRecorder(stream, { mimeType: mime });
    } catch (err) {
      this.rec = null;
      this.onDone?.(err instanceof Error ? err : new Error(String(err)));
      return false;
    }

    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.onstop = () => this.save();
    this.rec.onerror = () => {
      this.state = 'idle';
      this.onDone?.(new Error('recording failed'));
    };
    this.rec.start();
    this.state = 'recording';
    return true;
  }

  /** Copy the current output into the clip. Call right after rendering it. */
  frame(src: CanvasImageSource): void {
    if (!this.active) return;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(src, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** The pass ended: hold on the final frame, then stop and save. */
  hold(): void {
    if (this.state !== 'recording') return;
    this.still.width = this.canvas.width;
    this.still.height = this.canvas.height;
    this.still.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.state = 'holding';
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      this.rec?.stop();
    }, HOLD_MS);
  }

  /**
   * Keep the stream alive through the hold. A capture stream only emits
   * frames when its canvas actually changes, so the final frame is stamped
   * back once per animation frame. This is a plain 2D blit and costs nothing
   * like re-running the effect chain would.
   */
  tick(): void {
    if (this.state !== 'holding') return;
    this.ctx.drawImage(this.still, 0, 0);
  }

  /** Drop the clip without saving. */
  cancel(): void {
    if (!this.active) return;
    window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.state = 'idle';
    const rec = this.rec;
    this.rec = null;
    this.chunks = [];
    if (rec) {
      rec.onstop = null;
      rec.onerror = null;
      if (rec.state !== 'inactive') rec.stop();
    }
  }

  private save(): void {
    const chunks = this.chunks;
    this.chunks = [];
    this.rec = null;
    this.state = 'idle';
    if (!chunks.length) {
      this.onDone?.(new Error('no frames were captured'));
      return;
    }
    const type = this.mime.split(';')[0];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scan-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    this.onDone?.();
  }
}
