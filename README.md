# FractalCam

Turns your live webcam into a moving fractal, a kaleidoscopic creature or a glitching signal, in real time on your GPU, and sends the result to Zoom through OBS Virtual Camera.

The entire frame is transformed: your face, body, clothes and room. Your movements drive it. Opening your mouth tears the fractal open, raising your eyebrows shifts the palette and brightness, tilting or turning your head rotates space, blinking fires a pulse from your eyes, and any movement adds energy and speed.

Everything runs locally in the browser. There's no server-side processing, no cloud inference, no API keys, and no network access after `npm install`.

```
Windows webcam ─► Chrome/Edge (Windows) ─► WebGL2 shaders ─► "FractalCam Output" window
                                                               │
                         Zoom ◄─ OBS Virtual Camera ◄─ OBS Window Capture
```

---

## Quick start (WSL2 + Windows)

**You need:** Node.js ≥ 20.19 inside WSL (`node -v`), current Chrome or Edge on Windows, and [OBS Studio](https://obsproject.com/) 28+ installed on Windows.

In the WSL terminal (for example from Claude Code):

```bash
cd ~/code/fractal-cam     # this project
npm install               # also copies MediaPipe WASM + downloads face/pose models (~10 MB)
npm run dev
```

Then, **in Chrome or Edge on Windows**, open:

> **http://localhost:5173**

Use `localhost`, not the WSL IP address (`172.x.x.x`). Browsers only allow camera access on `localhost` or HTTPS.

1. Click **Enable camera** and allow access. To avoid a second prompt in the output window, choose "Allow on every visit" if offered.
2. Pick an effect with the big buttons or keys **1–4**.
3. Click **Open output window**. A 1280×720 window titled **FractalCam Output** opens. It now owns the camera, and the control panel mirrors it in its preview.
4. Set up OBS and Zoom as described below.

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm test` | Typecheck, unit tests, production build, browser tests |
| `npm run test:unit` / `npm run test:e2e` | Just one test layer |
| `npm run assets` | Re-copy the MediaPipe WASM and re-download the tracking models |

---

## Effects

| Key | Effect | What it does | How you drive it |
|---|---|---|---|
| 1 | **Fractal Warp** | Camera image folded through an iterated inversion fractal, radially mirrored, fed back into a rotating tunnel | Mouth → tears the fold open and adds turbulence · head roll/yaw → spins space · raised hands (body tracking) → vortices · movement → glowing scars |
| 2 | **Kaleidoscopic Being** | The whole frame becomes a two-layer rotating mandala centred on your face | Head roll → turns the wheel · mouth → zoom and ripples · movement → rings and flares · **Segments** slider = symmetry count |
| 3 | **Fractal Entity** | A Julia set whose domain and parameter are bent per pixel by the camera image, with your picture mapped through the orbit trap so your face repeats inside the spirals | Head yaw/pitch → steer the Julia parameter · mouth → makes it boil · hands → drag it · movement → perturbs it locally |
| 4 | **Glitch Dimension** | Scanline tears, block fragmentation, chromatic aberration from your face, Sobel-edge neon, posterisation, static, and datamosh smearing wherever you hold still | Movement and mouth → more glitching · head yaw → signal slides sideways · blink → a scan sweep at eye height |

In every effect, **raising your eyebrows** shifts the palette and brightness, and **blinking** fires a pulse from your eyes.

Controls (saved per effect in `localStorage`): **Intensity, Animation speed, Symmetry/Segments/Iterations/Fragmentation, Distortion, Saturation, Camera contribution, Feedback trails, Palette**, plus **Randomize** and **Reset to defaults**.

### Keyboard shortcuts

These work in both the control panel and the output window.

| Key | Action |
|---|---|
| `1`–`4` | Select effect |
| `Space` | Pause/resume the procedural animation (the camera stays live) |
| `R` | Randomize the current effect's parameters |
| `F` | Fullscreen clean output (no UI, no cursor) |
| `H` | Hide/show the control interface |

---

## Connecting to OBS and Zoom (Windows)

### 1. Capture the output window in OBS

1. In FractalCam, click **Open output window**. Leave it at 1280×720 and **don't minimise it** (see "Window occlusion" below).
2. OBS → **Settings → Video**: Base (Canvas) Resolution **1280x720**, Output (Scaled) Resolution **1280x720**, Common FPS Values **30**. Click OK.
3. In the **Sources** panel, click **+** → **Window Capture** → name it "FractalCam" → OK.
   - **Window:** `[chrome.exe]: FractalCam Output` (or `[msedge.exe]: FractalCam Output`)
   - **Capture Method:** `Windows 10 (1903 and up)`. BitBlt usually shows black for Chrome/Edge.
   - **Capture Cursor:** unticked
   - **Client Area:** ticked
4. Right-click the source → **Transform → Fit to screen** (Ctrl+F).
5. **Remove the browser's address strip.** Chrome/Edge popup windows draw a thin bar with the URL at the top, and OBS captures it. Hold **Alt** and drag the source's top edge down until the bar disappears, or right-click → **Filters → + → Crop/Pad** and raise **Top** until it's gone (usually 30–60 px, depending on display scaling). Then Fit to screen again.
   - *Alternative with no cropping:* press **F** inside the output window to make it fullscreen. This is ideal on a second monitor.

### 2. Start the virtual camera

In OBS's **Controls** dock, click **Start Virtual Camera**.

### 3. Select it in Zoom

Zoom → **Settings → Video → Camera** → **OBS Virtual Camera**.

- Zoom's **"Mirror my video"** only flips *your own* self-view. Other participants always see exactly what OBS sends.
- Make sure Zoom (and Teams, etc.) is set to *OBS Virtual Camera*, not your physical webcam. Many webcams can only be opened by one app at a time, and Chrome needs it.

### Window occlusion and minimising (important)

Chrome and Edge stop drawing windows that are **minimised**, and on Windows they also stop drawing windows that are **completely covered** by other windows. OBS then shows a frozen frame. Either:

- keep a sliver of the output window visible (or put it on a second monitor), **or**
- start a dedicated browser instance that keeps rendering while covered. Create a Windows shortcut with this target (adjust the path for Edge):

  ```
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%LOCALAPPDATA%\FractalCamChrome" --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding http://localhost:5173
  ```

  The separate `--user-data-dir` matters, because flags are ignored if Chrome is already running with your normal profile. Minimising still pauses rendering, even with these flags.

### Mirroring and aspect ratio

- **Mirror (selfie view)** is on by default, so moving your right hand moves the image on the right, like a mirror. The mirrored image is what Zoom participants see, so any text behind you will appear reversed. Turn Mirror off in the Camera section if that matters. Head-rotation directions are corrected automatically for either setting.
- The output is always **16:9 at 1280×720**. Cameras with other shapes (4:3 webcams at 640×480, ultrawide) are **cover-cropped**: scaled to fill 16:9 with the excess trimmed equally from the top/bottom or sides. Nothing is stretched. The camera resolution is shown in the top bar (`cam W×H`).
- If the output window isn't 16:9, the image is letterboxed with black bars inside it. Keep the window at 16:9, or crop in OBS.

### Why not an OBS Browser Source?

OBS's embedded browser runs separately from Chrome. It can't show camera permission prompts and doesn't reliably get webcam access, so capturing the real browser window is the dependable path. A Browser Source pointed at `/output` would need OBS launch flags for camera access. This hasn't been verified, so it isn't supported here.

---

## How it works

```
src/
  capture/camera.ts           getUserMedia, device list, readable errors, virtual-camera detection, track cleanup
  capture/syntheticSource.ts  animated, clearly labelled test pattern (canvas.captureStream), not your camera
  engine/Engine.ts            requestAnimationFrame loop: source → motion + tracking → uniforms → renderer; stats/status events
  engine/Renderer.ts          Three.js WebGL2: one full-screen quad, one RawShaderMaterial per effect,
                              two ping-pong render targets (feedback), one upscaling copy pass; all allocated once
  engine/cameraMapping.ts     16:9 cover-crop + mirror mapping, and landmark → screen mapping
  engine/PerfMonitor.ts       FPS counter + adaptive render scale (100/85/70/55/45 %), with oscillation guard
  shaders/*.glsl|*.frag|*.vert  common prelude (uniforms, noise, palettes, kaleid fold) + one file per effect
  motion/MotionEstimator.ts   frame difference on a 64×36 copy: global energy, centroid, decaying motion map texture
  tracking/tracker.worker.ts  MediaPipe Face Landmarker (+ optional Pose Landmarker) in a Web Worker
  tracking/TrackingClient.ts  sends ≤24 downscaled frames/s (never more than one in flight), adapts to latency
  tracking/signals.ts         blendshapes/matrix → mouth, brows, blink pulse, smile, yaw/pitch/roll, hands; smoothing
  params/                     schema + ranges + clamping, palettes, observable store with localStorage persistence
  sync/channel.ts             BroadcastChannel protocol between the control panel and the output window
  ui/ControlApp.tsx           control panel (React). Only the stats bar re-renders, at 2 Hz, never per frame
  ui/OutputApp.tsx            /output: the canvas only, no cursor
```

Key decisions:

- **One camera, one GPU pipeline.** While the output window is open, it owns the camera and renders. The control panel releases its camera, stops rendering, mirrors the output window's canvas via `captureStream()`, and keeps sending parameter changes over `BroadcastChannel`. Closing the output window hands the camera back automatically, detected by a heartbeat. If you open `/output` by hand rather than with the button, the panel can't mirror it and says so; the controls still work.
- **Tracking never blocks rendering.** MediaPipe runs in a Web Worker on downscaled `ImageBitmap`s (480 px wide), one frame in flight at a time. It uses the GPU delegate when available and falls back to CPU. Signals are smoothed per rendered frame and relax to neutral when the face is lost, so effects keep working without a face, a body, or the models.
- **Integrated-GPU friendly.** Each frame is one effect pass at the internal resolution plus one cheap copy pass to the 1280×720 canvas. Feedback reuses the previous render target, so no extra blur or bloom passes are needed. A 30 fps cap is on by default, and adaptive quality lowers the internal resolution when the frame rate drops.
- **Fallbacks.** Without WebGL2 you get the plain camera with an animated CSS colour effect and an explanation. If the models are missing, tracking reports it and the effects still run on motion. If the camera fails, you get a specific message with **Retry** and **Use test pattern**.

---

## Testing

`npm test` runs the following.

| Layer | What is verified |
|---|---|
| `tsc --noEmit` | TypeScript compiles (strict) |
| **Unit (Vitest, 32 tests)** | Parameter ranges, clamping of corrupt/hostile stored settings, randomize stays in range, persistence (pause not saved), cover-crop/mirror mapping and its inverse, route detection, head-pose Euler extraction, blendshape normalization, smoothing (frame-rate independent, relaxes on loss, one pulse per blink), motion estimator (localization, GL orientation, decay), FPS counter, adaptive quality (step down, step up, anti-oscillation), camera error mapping, virtual-camera detection |
| `vite build` | Production build succeeds |
| **Browser (Playwright + headless Chromium, 11 tests)** | All 4 shaders compile on real WebGL2 (SwiftShader) and produce distinct non-black output from a camera stream · synthetic mode + motion estimator · rapid effect switching (keys + buttons) · slider and randomize ranges, corrupt localStorage, reload · **blocked permission** (real `NotAllowedError`), missing camera, camera in use · `/output` has no controls, text or cursor, and fills the window · **camera acquisition and cleanup**: switching sources releases tracks, the output window takes over the camera, the panel releases it and mirrors, settings sync both ways, closing the output re-acquires, dispose releases · Space/R/H/F shortcuts and clean fullscreen · WebGL-unavailable fallback · **face tracking on a real portrait photo**: face found, smile detected, rotating the photo ±0.4 rad gives head roll of ∓0.4 rad; pose tracker loads alongside |

The browser tests use the globally installed Playwright (`npm i -g playwright` + `npx playwright install chromium`). They download MediaPipe's public sample portrait on first run (gitignored). Screenshots go to `tests/e2e/artifacts/`.

### What automated tests cannot verify (manual checklist)

These need your hardware and Windows. Please check them once:

- [ ] `http://localhost:5173` opens in Windows Chrome/Edge while `npm run dev` runs in WSL
- [ ] Your physical webcam appears in the Camera dropdown and **Enable camera** shows your live image transformed
- [ ] Opening your mouth, raising your eyebrows, tilting your head and blinking visibly change the effects (try **Fractal Warp** and **Kaleidoscopic Being**)
- [ ] FPS in the top bar holds near 30 at the render resolution shown (watch it for a minute; adaptive quality may step down)
- [ ] **Open output window** → OBS Window Capture shows it → Virtual Camera → Zoom shows it
- [ ] Output keeps moving while Zoom is in front (see "Window occlusion")

Frame rate on your Ryzen 7 7735U / Radeon 680M **has not been measured**. The headless test browser renders on the CPU (SwiftShader) at about 15 fps, which says nothing about your GPU.

---

## Troubleshooting

**`localhost:5173` doesn't load on Windows.** Make sure `npm run dev` is still running in WSL. Run `wsl --shutdown` from PowerShell, reopen WSL, and try again. Check that `%UserProfile%\.wslconfig` doesn't set `localhostForwarding=false`. As a last resort, run `npm run dev -- --host 0.0.0.0` and open `http://<WSL IP>:5173`. That isn't a secure context, so the camera only works there if you add the address under `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

**"Camera access was blocked".** Click the camera/lock icon left of the address bar → Camera → Allow, then press Retry. Also check Windows **Settings → Privacy & security → Camera**: Camera access *On*, "Let apps access your camera" *On*, and "Let desktop apps access your camera" *On*.

**"Camera … could not be started".** Another app has it open. Close the Windows Camera app and Teams, and make sure Zoom is set to *OBS Virtual Camera*, then press Retry.

**Camera list shows "⚠ … (virtual — feedback loop!)".** That's OBS Virtual Camera or similar. Don't use it as FractalCam's input. "Default camera" skips virtual cameras automatically.

**Low FPS.**
- Plug in the laptop and use the *Best performance* power mode.
- Make sure **Settings → System → Use graphics acceleration when available** is on in Chrome/Edge (`chrome://gpu` should say "Hardware accelerated" for WebGL2).
- Leave **Adaptive quality** on, or pick a lower **Render scale**.
- Turn off **Body tracking**.
- Lower **Iterations** on Fractal Entity; it's the heaviest effect.

**Tracking says "models missing".** Run `npm run assets` (needs network once), then reload. To try the other MediaPipe backend, open `http://localhost:5173/?tracker=cpu` or `?tracker=gpu`.

**Face isn't detected.** Light your face from the front, face the camera, and make sure the face is at least about 1/6 of the frame height. The effects still respond to motion without a face.

**OBS shows black.** Use Capture Method *Windows 10 (1903 and up)*. If it's still black, in OBS go to **Settings → Advanced** and check that the renderer is Direct3D 11.

**OBS shows a frozen image.** The output window is minimised or fully covered. See "Window occlusion" above.

**Output window opened without a preview in the panel.** You opened `/output` manually. Close it and use the **Open output window** button.

**`npm install` fails with "Cannot read properties of null (reading 'edgesOut')".** That's an npm 10.8 bug with optional peer dependencies. The included `.npmrc` (`legacy-peer-deps=true`) avoids it, so make sure you run the install from the project folder.

---

## Known limitations

- **Performance on your machine is unverified.** The design targets 1280×720 at 30 fps on integrated graphics, but that has only been measured in a CPU-emulated test browser.
- **Window capture needs the output window drawn.** Minimising it freezes OBS. Occlusion needs either visibility or the launch flags above.
- **Popup address bar.** Chrome/Edge popups show a URL strip that has to be cropped in OBS, or use fullscreen (F).
- **Mirror preview** only works when the output window was opened from the panel's button.
- **Blink/gaze pulses** depend on MediaPipe blendshape quality. Blinks are usually reliable in good light; gaze is only used as a small offset. **Body tracking** is optional, costs extra GPU/CPU, and needs your shoulders in frame.
- **Head-pose signs** were verified for roll on a real photo. Yaw and pitch use the same verified matrix extraction (unit-tested), but their on-screen direction is a matter of taste and hasn't been tuned with a live person.
- **Microphone/audio** isn't used. Zoom gets audio from your normal microphone.
