# Virtual Scanner

A browser app that behaves like a flatbed photocopier. The viewport is the
glass, a scan bar sweeps across it, and the output is built one row at a time
from whatever is under the bar at that instant. Drag an image mid-scan and it
stretches, repeats, smears or shears exactly the way paper does on a real
scanner. A WebGL post-process chain then turns the result into a gritty copy.

Everything runs in the browser; images never leave it. See `SCANNER_PLAN.md`
for the design.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static site in dist/

## Use

1. Drop an image on the page, paste one, or click **Open**. It lands centred
   on the glass at native size (scaled down only if bigger than the glass).
2. Drag to move. Wheel or pinch to scale. Shift-drag, pinch-twist or the ring
   above the selection to rotate. Arrows nudge 1 px, shift-arrows 10 px.
3. Pick a mode in the panel (Early copier, 90s office laser, Fax, Flatbed
   CCD, Generation loss, Manual) or set the sliders yourself. The panel is the
   darkroom: nothing in it re-runs the scan.
4. Press **Scan** (or space). The bar sweeps over *Speed* seconds. Move the
   image while the bar crosses it:
   - drag **with** the bar, a little slower than it: the image stretches into bars
   - drag **against** it: the image compresses and repeats
   - drag **across** it: shear
   - hold **H** to pause the bar and reposition
5. **Save PNG** exports the output through the effect chain at full resolution.

### Collage

**Collage** stops each pass from wiping the sheet, so scans stack. Move the
image, or swap it, and scan again. The picker beside it decides how a new pass
lands on the ones before it:

- **darken** keeps whatever is darker. White paper lets earlier passes show
  through, so only the marks build up. This is the stacked-photocopy look and
  the right default on a closed (white) lid.
- **over** paints the sheet opaquely, so later passes cover earlier ones the
  way overlapping paper does.
- **lighten** is the inverse of darken, for working on a black sheet with the
  lid open.

**Clear** starts a fresh sheet in the lid colour. Turning Collage off leaves the
finished collage on screen so it can still be exported; the next pass clears as
normal.

### Video

**Record** arms the next pass. The clip builds row by row as the bar sweeps,
then holds on the finished scan for five seconds, and saves when the pass ends.
Stopping a pass early still saves the take. Press Record again while it is
running to throw the clip away.

The clip is the output pane with the effect chain applied, longest edge 1080,
in H.264 MP4 where the browser can encode it and WebM otherwise. Bare
`video/mp4` is never requested: browsers report it as supported and may then
produce VP9 inside an MP4 container, which most players and upload pipelines
reject.

Other controls: **Lid** open/closed (black or white background, and the Lid
leak stage), **Sweep** direction, **Reverse**, **Loop** (sweep continuously
until **Capture** freezes the current pass), **Forward / Back / Delete** for
the selected image, **Undo** (Ctrl+Z) for placements, and output size presets
with a dpi readout. Custom modes and the current settings persist in
localStorage; **Export / Import** in the panel move them as JSON.

## Manual test checklist

- Phase 1: paste a HELLO image, set speed to 6 s, scan, and drag the image
  down with the bar at about 70% of its speed. Letters stretch into bars.
  Drag up against the bar: letters compress and repeat.
- Phase 2: with a finished scan, switch modes. Early copier gives clean
  1-bit with ragged edges; Flatbed CCD gives grain and per-line jitter;
  toggling a stage checkbox isolates that stage.
- Phase 2b: set Exposure to 1 and jerk the image sideways while the bar
  crosses it: rows captured in motion are grey smears, not hard slices.
- Phase 3: load two images, tap to select, Back/Forward, drag the ring to
  rotate, Loop + Capture, hold H mid-scan.
- Phase 4: change the output size preset, export a JSON, Import it back,
  Ctrl+Z after a drag.
- Collage: turn it on, scan, move the image, scan again. Both passes are on
  the sheet. Turn it off and scan: the sheet clears again.
- Video: arm Record, scan, and wait. The file lands when the hold ends and
  should play the sweep followed by a five second still.

## Deploy

GitHub Pages: `.github/workflows/pages.yml` builds with `--base=/virtual-scanner/`
on every push to `main` and publishes `dist/`. Enable it once under repo
Settings → Pages → Source: GitHub Actions. Live at
https://denvertg.github.io/virtual-scanner/.

The app is a static Vite site with no environment variables and no backend,
so any static host works; `vercel.json` is included for Vercel.
