// The darkroom: a WebGL2 post-process chain applied to the frozen output.
//
// Passes, in the order light hits the sensor:
//   extract + blur  -> low-res blurred highlights for light bleed
//   chain           -> grayscale, bleed, lid leak, levels, jitter, streaks,
//                      edge roughness, threshold / dither, grain, dropout
//   regen x N       -> generation loss: blur then threshold again
//   paper           -> tint and vignette, to the screen or an export buffer
//
// Every random stage hashes the seed so a look is reproducible. Noise is
// computed in output texel coordinates so the preview matches the export.

import type { Direction } from './scanner';

export interface EffectParams {
  seed: number;
  axis: Direction;
  lidOpen: boolean;

  bleedOn: boolean; bleedSpread: number; bleedIntensity: number;
  leakOn: boolean; leakReach: number;

  levelsOn: boolean; black: number; white: number; gamma: number;
  threshOn: boolean; thresh: number; threshSoft: number;
  dither: number; ditherCell: number; ditherAngle: number;
  genLoss: number;

  grainOn: boolean; grain: number; grainSize: number;
  roughOn: boolean; rough: number;
  jitterOn: boolean; jitter: number;
  streakOn: boolean; streak: number; streakWidth: number;
  dropOn: boolean; dropout: number;

  paperOn: boolean; tint: number; vignette: number;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform float u_flip;
void main() {
  vec2 uv = a_pos * 0.5 + 0.5;
  v_uv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, u_flip));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const PRELUDE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform float u_seed;
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(float x) { float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), u); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const EXTRACT = PRELUDE + `
void main() {
  float v = luma(texture(u_tex, v_uv).rgb);
  o = vec4(vec3(max(v - 0.55, 0.0) / 0.45), 1.0);
}`;

const BLUR = PRELUDE + `
uniform vec2 u_dir;
void main() {
  vec2 px = u_dir / u_size;
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  float v = texture(u_tex, v_uv).r * w[0];
  for (int i = 1; i < 5; i++) {
    v += texture(u_tex, v_uv + px * float(i)).r * w[i];
    v += texture(u_tex, v_uv - px * float(i)).r * w[i];
  }
  o = vec4(vec3(v), 1.0);
}`;

const CHAIN = PRELUDE + `
uniform sampler2D u_bleed;
uniform int u_axis;
uniform float u_lidOpen;
uniform float u_bleedOn, u_bleedIntensity;
uniform float u_leakOn, u_leakReach;
uniform float u_levelsOn, u_black, u_white, u_gamma;
uniform float u_threshOn, u_thresh, u_threshSoft;
uniform int u_dither;
uniform float u_ditherCell, u_ditherAngle;
uniform float u_grainOn, u_grain, u_grainSize;
uniform float u_roughOn, u_rough;
uniform float u_jitterOn, u_jitter;
uniform float u_streakOn, u_streak, u_streakWidth;
uniform float u_dropOn, u_dropout;

// Ordered dither threshold for a 2^levels square Bayer matrix, in 0..1.
float bayer(ivec2 p, int levels) {
  float acc = 0.0;
  float n = pow(4.0, float(levels));
  float f = n / 4.0;
  for (int i = 0; i < 3; i++) {
    if (i >= levels) break;
    int x = (p.x >> i) & 1;
    int y = (p.y >> i) & 1;
    acc += float(((x ^ y) << 1) | y) * f;
    f /= 4.0;
  }
  return (acc + 0.5) / n;
}

void main() {
  vec2 p = v_uv * u_size;
  vec2 seed = vec2(u_seed * 0.731, u_seed * 1.317);
  float v = luma(texture(u_tex, v_uv).rgb);

  // Light.
  v += u_bleedOn * u_bleedIntensity * texture(u_bleed, v_uv).r;
  if (u_leakOn * u_lidOpen > 0.5) {
    float d = min(min(p.x, p.y), min(u_size.x - p.x, u_size.y - p.y));
    float l = 1.0 - smoothstep(0.0, max(1.0, u_leakReach), d);
    v = mix(v, 1.0, l * l * 0.9);
  }

  // Tone.
  if (u_levelsOn > 0.5) {
    v = clamp((v - u_black) / max(0.001, u_white - u_black), 0.0, 1.0);
    v = pow(v, 1.0 / max(0.05, u_gamma));
  }

  // Texture before the threshold: things the sensor did.
  float lineIdx = (u_axis == 0) ? floor(p.y) : floor(p.x);
  float across  = (u_axis == 0) ? p.x : p.y;
  float along   = (u_axis == 0) ? p.y : p.x;
  if (u_jitterOn > 0.5) v += (hash11(lineIdx + seed.x * 100.0) - 0.5) * u_jitter;
  if (u_streakOn > 0.5) {
    float w = max(1.0, u_streakWidth);
    float n = vnoise(across / w + seed.y * 10.0) * 0.65 + vnoise(across / (w * 0.23) + seed.x * 10.0) * 0.35;
    float slow = vnoise(along / (w * 8.0) + seed.y * 30.0);
    v *= 1.0 - u_streak * (n - 0.5) * (0.7 + 0.8 * slow);
  }
  bool binary = u_threshOn > 0.5 || u_dither > 0;
  if (u_roughOn > 0.5 && binary) {
    float r1 = hash12(p + seed * 50.0) - 0.5;
    float r2 = hash12(floor(p * 0.5) + seed * 70.0) - 0.5;
    v += (r1 * 0.5 + r2 * 0.5) * u_rough;
  }

  // Threshold and dither.
  if (u_dither == 3) {
    float a = radians(u_ditherAngle);
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 q = (R * p) / max(1.0, u_ditherCell);
    vec2 f = fract(q) - 0.5;
    float d = length(f) * 2.0;
    float rad = sqrt(clamp(1.0 - v, 0.0, 1.0)) * 1.13;
    v = smoothstep(rad - 0.06, rad + 0.06, d);
  } else if (u_dither > 0) {
    int lv = u_dither == 1 ? 2 : 3;
    float sz = float(1 << lv);
    ivec2 ip = ivec2(mod(floor(p), sz));
    v = step(bayer(ip, lv), v);
  } else if (u_threshOn > 0.5) {
    float s = u_threshSoft;
    float hard = s < 0.001 ? step(u_thresh, v) : smoothstep(u_thresh - s * 0.5, u_thresh + s * 0.5, v);
    v = mix(hard, v, s);
  }

  // Texture after the threshold: things the toner did.
  if (u_grainOn > 0.5) {
    vec2 gp = floor(p / max(1.0, u_grainSize));
    v += (hash12(gp + seed * 90.0) - 0.5) * u_grain;
  }
  if (u_dropOn > 0.5) {
    vec2 dp = floor(p / 2.0);
    float h = hash12(dp + seed * 110.0);
    if (h < u_dropout * 0.03 && v < 0.5) v = 1.0;
  }

  o = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}`;

// One generation of copying: soften, add a little noise, threshold again.
const REGEN = PRELUDE + `
uniform float u_pass;
void main() {
  vec2 px = 1.6 / u_size;
  float v = 0.0;
  float wsum = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
      v += w * texture(u_tex, v_uv + vec2(float(i), float(j)) * px).r;
      wsum += w;
    }
  }
  v /= wsum;
  vec2 p = v_uv * u_size;
  v += (hash12(p + vec2(u_seed * 3.0, u_pass * 7.1)) - 0.5) * 0.22;
  v = smoothstep(0.40, 0.60, v);
  o = vec4(vec3(v), 1.0);
}`;

const PAPER = PRELUDE + `
uniform float u_paperOn, u_tint, u_vignette;
void main() {
  vec3 c = vec3(texture(u_tex, v_uv).r);
  if (u_paperOn > 0.5) {
    c = mix(c, c * vec3(1.0, 0.955, 0.86), u_tint);
    float d = length(v_uv - 0.5) * 1.414;
    c *= 1.0 - u_vignette * 0.85 * smoothstep(0.35, 1.1, d);
  }
  o = vec4(c, 1.0);
}`;

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class Effects {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly programs: Record<'extract' | 'blur' | 'chain' | 'regen' | 'paper', Program>;
  private readonly source: WebGLTexture;
  private srcW = 0;
  private srcH = 0;
  private full: [Target, Target] | null = null;
  private bleed: [Target, Target] | null = null;
  private exportTarget: Target | null = null;
  private params: EffectParams | null = null;
  private sourceDirty = true;
  private paramsDirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.programs = {
      extract: this.compile(EXTRACT),
      blur: this.compile(BLUR),
      chain: this.compile(CHAIN),
      regen: this.compile(REGEN),
      paper: this.compile(PAPER),
    };
    this.source = this.makeTexture(gl.LINEAR);
  }

  // ---- public ----------------------------------------------------------

  /** Upload a fresh copy of the output buffer next render. */
  markSourceDirty(): void {
    this.sourceDirty = true;
  }

  setParams(p: EffectParams): void {
    this.params = p;
    this.paramsDirty = true;
  }

  get needsRender(): boolean {
    return this.sourceDirty || this.paramsDirty;
  }

  /** Render the chain to the on-screen canvas at its current backing size. */
  render(source: HTMLCanvasElement): void {
    if (!this.params) return;
    this.uploadSource(source);
    this.runChain();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.paperPass(this.full![0], 1);
    this.paramsDirty = false;
  }

  /** Render the chain at full output resolution and return the pixels as a canvas. */
  exportCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
    if (!this.params) throw new Error('no params');
    this.uploadSource(source);
    this.runChain();
    const gl = this.gl;
    const w = this.srcW;
    const h = this.srcH;
    if (!this.exportTarget || this.exportTarget.w !== w || this.exportTarget.h !== h) {
      if (this.exportTarget) this.destroyTarget(this.exportTarget);
      this.exportTarget = this.makeTarget(w, h, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.exportTarget.fbo);
    gl.viewport(0, 0, w, h);
    this.paperPass(this.full![0], 0);
    const pixels = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.putImageData(new ImageData(pixels, w, h), 0, 0);
    return out;
  }

  // ---- passes ------------------------------------------------------------

  private uploadSource(source: HTMLCanvasElement): void {
    const gl = this.gl;
    const resized = source.width !== this.srcW || source.height !== this.srcH;
    if (!this.sourceDirty && !resized) return;
    this.srcW = source.width;
    this.srcH = source.height;
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.sourceDirty = false;
    if (resized) {
      if (this.full) this.full.forEach((t) => this.destroyTarget(t));
      this.full = [this.makeTarget(this.srcW, this.srcH, gl.LINEAR), this.makeTarget(this.srcW, this.srcH, gl.LINEAR)];
    }
  }

  private runChain(): void {
    const gl = this.gl;
    const p = this.params!;
    const w = this.srcW;
    const h = this.srcH;

    // Light bleed: highlights at reduced resolution, blurred both ways.
    let bleedTex: WebGLTexture | null = null;
    if (p.bleedOn && p.bleedIntensity > 0) {
      const ds = Math.min(16, Math.max(1, Math.round(p.bleedSpread / 3)));
      const bw = Math.max(1, Math.ceil(w / ds));
      const bh = Math.max(1, Math.ceil(h / ds));
      if (!this.bleed || this.bleed[0].w !== bw || this.bleed[0].h !== bh) {
        if (this.bleed) this.bleed.forEach((t) => this.destroyTarget(t));
        this.bleed = [this.makeTarget(bw, bh, gl.LINEAR), this.makeTarget(bw, bh, gl.LINEAR)];
      }
      const [a, b] = this.bleed;
      this.use('extract', { u_size: [bw, bh], u_flip: 0 });
      this.draw(a, this.source);
      const radius = Math.max(0.5, p.bleedSpread / ds / 3);
      this.use('blur', { u_size: [bw, bh], u_flip: 0, u_dir: [radius, 0] });
      this.draw(b, a.tex);
      this.use('blur', { u_size: [bw, bh], u_flip: 0, u_dir: [0, radius] });
      this.draw(a, b.tex);
      bleedTex = a.tex;
    }

    // Main chain into full[0].
    const [f0, f1] = this.full!;
    this.use('chain', {
      u_size: [w, h],
      u_flip: 0,
      u_seed: p.seed,
      u_axis: p.axis === 'vertical' ? 0 : 1,
      u_lidOpen: p.lidOpen ? 1 : 0,
      u_bleedOn: bleedTex ? 1 : 0,
      u_bleedIntensity: p.bleedIntensity,
      u_leakOn: b2f(p.leakOn),
      u_leakReach: p.leakReach,
      u_levelsOn: b2f(p.levelsOn),
      u_black: p.black,
      u_white: p.white,
      u_gamma: p.gamma,
      u_threshOn: b2f(p.threshOn),
      u_thresh: p.thresh,
      u_threshSoft: p.threshSoft,
      u_dither: p.dither,
      u_ditherCell: p.ditherCell,
      u_ditherAngle: p.ditherAngle,
      u_grainOn: b2f(p.grainOn),
      u_grain: p.grain,
      u_grainSize: p.grainSize,
      u_roughOn: b2f(p.roughOn),
      u_rough: p.rough,
      u_jitterOn: b2f(p.jitterOn),
      u_jitter: p.jitter,
      u_streakOn: b2f(p.streakOn),
      u_streak: p.streak,
      u_streakWidth: p.streakWidth,
      u_dropOn: b2f(p.dropOn),
      u_dropout: p.dropout,
    });
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bleedTex ?? this.source);
    gl.uniform1i(this.programs.chain.loc.get('u_bleed') ?? null, 1);
    gl.activeTexture(gl.TEXTURE0);
    this.draw(f0, this.source);

    // Generation loss: ping-pong, ending back in full[0].
    const gens = Math.round(p.genLoss);
    for (let i = 0; i < gens; i++) {
      this.use('regen', { u_size: [w, h], u_flip: 0, u_seed: p.seed, u_pass: i + 1 });
      this.draw(f1, f0.tex);
      this.copy(f0, f1.tex, w, h);
    }
  }

  /** Straight copy via the paper program with paper off. */
  private copy(dst: Target, src: WebGLTexture, w: number, h: number): void {
    this.use('paper', { u_size: [w, h], u_flip: 0, u_paperOn: 0, u_tint: 0, u_vignette: 0 });
    this.draw(dst, src);
  }

  private paperPass(src: Target, flip: number): void {
    const p = this.params!;
    this.use('paper', {
      u_size: [this.srcW, this.srcH],
      u_flip: flip,
      u_paperOn: b2f(p.paperOn),
      u_tint: p.tint,
      u_vignette: p.vignette,
    });
    this.draw(null, src.tex);
  }

  // ---- GL plumbing ------------------------------------------------------

  private use(name: keyof Effects['programs'], uniforms: Record<string, number | number[]>): void {
    const gl = this.gl;
    const prog = this.programs[name];
    gl.useProgram(prog.prog);
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = prog.loc.get(k);
      if (loc === undefined) {
        prog.loc.set(k, gl.getUniformLocation(prog.prog, k));
      }
      const l = prog.loc.get(k) ?? null;
      if (l === null) continue;
      if (Array.isArray(v)) gl.uniform2f(l, v[0], v[1]);
      else if (k === 'u_axis' || k === 'u_dither') gl.uniform1i(l, v);
      else gl.uniform1f(l, v);
    }
    const texLoc = prog.loc.get('u_tex') ?? gl.getUniformLocation(prog.prog, 'u_tex');
    prog.loc.set('u_tex', texLoc);
    gl.uniform1i(texLoc, 0);
  }

  private draw(target: Target | null, src: WebGLTexture): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private compile(frag: string): Program {
    const gl = this.gl;
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      }
      gl.attachShader(prog, sh);
    }
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return { prog, loc: new Map() };
  }

  private makeTexture(filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeTarget(w: number, h: number, filter: number): Target {
    const gl = this.gl;
    const tex = this.makeTexture(filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  private destroyTarget(t: Target): void {
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }
}

function b2f(b: boolean): number {
  return b ? 1 : 0;
}
