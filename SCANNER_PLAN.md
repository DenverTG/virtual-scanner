# Virtual Scanner — build plan

A browser app that behaves like a flatbed photocopier. The viewport is the glass. A scan bar sweeps across it. The output image is built one row at a time from whatever is under the bar at that instant, so dragging an image mid-scan produces the same smear/stretch/repeat warps a real scanner does. A post-process stage turns the result into a gritty black-and-white copy.

## The core mechanic (get this right first, everything else is decoration)

A real scanner is a slit-scan camera. Row N of the output was captured at the moment the bar reached row N. If the image moved between row N and row N+50, those rows sample different positions of the image. That is the entire warp effect. No warp math, no mesh distortion — just copy the strip under the bar into the output buffer each frame and never touch it again.

Implementation:

- Keep every placed image as an object: bitmap, x, y, scale, rotation, z.
- Each animation frame, render the full glass (all images at their current transforms, over the lid color) into an offscreen canvas at output resolution.
- The bar has a position in output rows and a speed in rows per frame. Each frame, `drawImage` the strip of rows the bar covered since last frame from the offscreen glass into the output buffer at the same rows. Rows behind the bar are frozen. Rows ahead are blank.
- Speed matters more than anything. A real flatbed takes 5–20 seconds per pass. At 60fps that is 300–1200 frames, which is what gives you fine control while dragging. Expose speed as seconds-per-pass, not px/frame.

Do the scan in output-resolution space, not screen space. The glass is displayed scaled to fit the viewport, but the offscreen glass and output buffer are, say, 2550×3300 (letter at 300dpi) or whatever the user picks. Pointer coordinates get mapped through the display transform. This is the one decision that is painful to retrofit — make it in Phase 1.

## Stack

Vanilla TypeScript, Vite, Canvas 2D for the scan loop, a WebGL2 fragment shader for the post-process effects. No framework — the whole UI is one canvas and a control strip, and a framework re-render loop fights with a 60fps draw loop. Deploys to Vercel as a static site. No backend: images never leave the browser.

Pointer Events API for all input (one code path covers mouse, touch, pen). Two-finger pinch for scale and rotate on mobile; on desktop, scroll-wheel for scale and shift+drag or a handle for rotation.

## Phases

Each phase ends with something you can open in a browser and use. Commit at the end of each.

### Phase 1 — Slit-scan works

- Vite + TS scaffold. One full-viewport canvas for the glass, one for output. On mobile, stack them or toggle; on desktop, side by side.
- Drop a file, click a file input, or paste from clipboard → image appears on the glass at native size, centered.
- Drag image with pointer. Pinch/wheel to scale. Rotation can wait.
- Lid toggle: open = black background, closed = white.
- Scan button: bar sweeps over N seconds, output builds row by row, visibly, while you drag the image around.
- Scan direction: vertical or horizontal. Both reference images depend on this (HELLO is a vertical sweep, the car is horizontal), so it goes in now, not Phase 3.
- Save output as PNG.

Done when: you can reproduce the two moves that make the reference images. Drag *with* the bar at close to its speed and the image stretches into bars (HELLO, left panel). Drag *against* it and the image compresses and repeats (HELLO, right panel). Drag across the bar and you get shear.

### Phase 2 — The photocopy look

The two references are two different looks and the chain has to reach both:

- `reference/hello-stretch.jpeg` — pure 1-bit. Hard threshold, no dither, slightly ragged edges, faint soft grey bands where the paper moved fast.
- `reference/car-smear.webp` — continuous tone. Heavy grain, crushed contrast, and a fine line structure across the whole frame where every scan line has slightly different brightness.

Run the frozen output through a shader with these stages, each with a slider and a bypass:

1. Grayscale (luma weights, not average).
2. Levels: black point, white point, gamma. This is where "crushed blacks, blown highlights" lives.
3. Threshold with softness. At zero softness this is the HELLO look; at full it's off and you have the car look.
4. Scan-line jitter: a per-row (or per-column, following scan direction) random brightness offset, low amplitude, seeded. This is the single biggest tell in the car image and it's cheap.
5. Grain: per-pixel noise, seeded so it's stable frame to frame until you re-scan. The car image needs a lot of it; put the slider range wide.
6. Edge roughness: a small amount of noise added *before* the threshold so 1-bit edges come out ragged instead of vector-clean.
7. Dither: ordered (Bayer 4×4 / 8×8) and halftone dot with angle and cell size. Neither reference uses it, so lower priority, but it's the third classic copier look.
8. Toner artifacts: streaks along the scan axis (low-frequency noise in one axis, multiplied in), dropout specks, slight directional blur.
9. Paper: a subtle warm tint option and vignette toward the edges.

Preview the effect chain live on the output canvas. Export applies the same shader at full resolution. The sliders live in the control panel described below; build the panel scaffold in this phase and wire stages into it as they land.

Done when: the two reference images can be approximated from a clean source without leaving the app.

### Phase 2b — Exposure blur (lives in scanner.ts, not effects.ts)

A real scan head integrates light over the time it takes to capture a row. When the paper is moving fast, that row is blurred along the motion. That's the soft grey smears in the HELLO left panel and the entire right third of the car image, and point-sampling one transform per frame can't produce it. Fix: when copying a strip, render the glass 2–4 times at transforms interpolated between the previous frame's and the current one, and blend them with reduced alpha. Skip the extra renders when nothing moved. Expose as an "exposure" slider.

### Phase 3 — Operator controls

- Scan speed, reverse direction, and a "hold" key that pauses the bar while pressed so you can reposition mid-scan.
- Loop mode: bar sweeps continuously, output keeps rewriting. Useful for finding a warp by feel, then hitting "capture" to freeze the current pass.
- Multiple images with z-order. Tap to select, bring forward/send back, delete.
- Rotation gesture and rotation handle.
- Re-scan uses the same images and transforms so you can iterate the movement.
- Keyboard: space = start/stop scan, arrows nudge selected image 1px (shift = 10px), which gives you deterministic drags that pointer input can't.

### Phase 4 — Ship

- Output size presets (letter 300dpi, A4, square 2048, custom) and a DPI readout.
- Finish the mode set from the control panel section, tune each against the references, and add JSON export/import.
- Undo for image transforms (not for scans; a scan is a take, re-scan is the undo).
- Mobile pass: prevent page scroll/zoom on the glass, handle orientation change, test file picking from the camera roll on iOS.
- Vercel deploy.

### Later, if wanted

- Record the scan pass as WebM/GIF (MediaRecorder on the output canvas) — the bar sweeping while the image stretches is a good clip on its own.
- Scan the *warped* output again (put the copy back on the glass) for generation-loss stacking.
- A "warm-up" lamp glow that leads the bar, purely cosmetic.

## Control panel

One panel, always visible on desktop (right rail), a bottom sheet on mobile. Every control is a slider with a numeric readout, and every effect stage has a bypass toggle so you can isolate what a single knob does. Changes preview live on the output canvas. Nothing here re-runs the scan; the scan is the take, the panel is the darkroom.

Top of panel: the scanner mode selector. Modes are presets that set every slider below *and* a few scan-loop behaviors (fidelity, exposure, default speed). Picking a mode then dragging a slider shows a "modified" dot next to the mode name; "save as" writes a custom mode.

### Modes (starting set, tune against the references)

| Mode | What it does |
|---|---|
| Early copier | Hard 1-bit threshold, no dither, edge roughness up, fidelity ~150dpi, mild bleed. The HELLO reference. |
| 90s office laser | Threshold with a little softness, light Bayer dither, toner streaks, dropout specks, fidelity 300dpi. |
| Fax | Fidelity ~100dpi and forced 1-bit, strong per-line jitter, horizontal-only dropout, slow default speed. |
| Flatbed CCD | Continuous tone, moderate grain, per-line jitter on, exposure blur on, fidelity 300–600dpi. The car reference. |
| Generation loss | Runs the chain, blurs slightly, runs threshold again. Simulates a copy of a copy; the count is a slider (1–5). |
| Manual | Everything at neutral. |

### Controls (grouped in the order light hits the sensor)

Scan
- Speed — seconds per pass.
- Exposure — the 2b blur amount. 0 = point sample, 1 = full frame-to-frame smear.
- Fidelity — internal sample resolution in dpi. Below the output size, the strip is sampled at fidelity dpi and upscaled nearest-neighbor, so low fidelity gives blocky pixels the way a low-res scan head does. This is a scan-loop setting and takes effect on the next pass, unlike everything below.

Light
- Light bleed — bright regions bloom into neighboring dark ones. Implemented as a blurred copy of the highlights added back before threshold. Two sliders: spread (blur radius in px at output res) and intensity. High values with the lid open give the glowing halos you get from a lamp on an unlidded scanner.
- Lid leak — with the lid open, ambient light falls off from the glass edges inward. Single slider for how far it reaches. Off when the lid is closed.
- Lamp glow — cosmetic gradient leading the bar on the *glass* view. No effect on output.

Tone
- Black point, white point, gamma.
- Threshold and threshold softness.
- Dither: none / Bayer 4 / Bayer 8 / halftone, plus cell size and angle for halftone.

Texture
- Grain amount.
- Grain size — noise generated at a fraction of output res and upscaled, so 1 = per-pixel, 8 = chunky.
- Edge roughness — noise injected before threshold. Only visible when threshold is active.
- Line jitter — per-scan-line brightness offset amplitude.
- Toner streaks — amplitude and width of low-frequency streaks along the scan axis.
- Dropout — density of white specks in dark areas.
- Seed — number field with a reroll button. Everything random above reads from it, so a look is reproducible.

Paper
- Tint (neutral → warm), vignette.

### Implementation notes for the panel

- Panel state is one flat object. The shader reads uniforms straight from it; modes are just JSON snapshots of that object plus a name. No separate preset schema.
- Persist the current state and custom modes in localStorage; JSON export/import for sharing.
- Build the panel from a single declarative list (id, label, group, min, max, step, default). Adding a knob later should be one line, not a new UI component.
- On mobile the sheet should be draggable to a half-height state so you can see the output while adjusting.

## Known traps

- Screen-space scanning caps your output at viewport resolution. Solved by scanning in output space from Phase 1.
- `getImageData` every frame will tank mobile performance. The scan loop itself needs zero per-pixel work; it's all `drawImage` with source/dest rects. Per-pixel work only happens in the shader.
- Pointer coordinates on a scaled canvas need the inverse of the display transform, and `devicePixelRatio` on top of that. Write one `screenToGlass()` function and use it everywhere.
- iOS Safari limits canvas size (roughly 16M pixels total, varies by device). Cap output presets on mobile or tile the export.
- Drag events that start on the canvas will trigger page scroll on mobile unless `touch-action: none` is set on it.
- A dropped image bigger than the glass should be placed at a sensible scale, not cropped silently.
- Do not smooth pointer input. The wobble in the HELLO letter edges is hand jitter and it's part of the look. If a smoothing option is ever added it should default to off.

## Working with Claude Code

Put the following in `CLAUDE.md` at the repo root:

```
This is a browser-only virtual flatbed scanner. See SCANNER_PLAN.md.

Constraints:
- Vanilla TypeScript + Vite. No UI framework. No backend.
- The scan loop uses only drawImage. Never call getImageData inside the animation loop.
- All scan math is in output-resolution space; the viewport is a scaled view of it.
- Pointer Events only; no separate mouse/touch handlers.
- One file per concern: glass.ts (image objects + rendering), scanner.ts (bar + output buffer), input.ts (pointer/gesture → transforms), effects.ts (WebGL post chain), panel.ts (declarative control list + mode presets), ui.ts (everything else), main.ts.
- Do not add features from a later phase while working on an earlier one.
- After each phase: run `npm run dev`, describe how to test it manually, commit.
```

Start each phase with a prompt of the form: "Implement Phase N from SCANNER_PLAN.md. Stop when the 'Done when' condition is met and tell me how to verify it." Claude Code will try to do Phase 2 shader work during Phase 1 if you don't pin it; the CLAUDE.md line above is there to stop that.

The two reference images are in `reference/`. Point Claude Code at them when tuning Phase 2 and 2b defaults; ask it to screenshot its own output next to them.
