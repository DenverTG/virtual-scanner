This is a browser-only virtual flatbed scanner. See SCANNER_PLAN.md.

Constraints:
- Vanilla TypeScript + Vite. No UI framework. No backend.
- The scan loop uses only drawImage. Never call getImageData inside the animation loop.
- All scan math is in output-resolution space; the viewport is a scaled view of it.
- Pointer Events only; no separate mouse/touch handlers.
- One file per concern: glass.ts (image objects + rendering), scanner.ts (bar + output buffer), input.ts (pointer/gesture → transforms), effects.ts (WebGL post chain), recorder.ts (canvas capture to video), panel.ts (declarative control list + mode presets), ui.ts (everything else), main.ts.
- Do not add features from a later phase while working on an earlier one.
- After each phase: run `npm run dev`, describe how to test it manually, commit.
