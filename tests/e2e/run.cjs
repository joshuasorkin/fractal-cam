#!/usr/bin/env node
// Browser tests for FractalCam: real Chromium, real WebGL2 (SwiftShader), real
// MediaPipe worker, and Chromium's fake camera device. Runs against the
// production build served by `vite preview`.
//
// What this CANNOT verify: your physical webcam, Windows Chrome/Edge GPU
// performance, OBS capture, and Zoom. See README "Manual verification".

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = path.join(__dirname, 'artifacts');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORTRAIT_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg';

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    try {
      const globalRoot = execSync('npm root -g').toString().trim();
      return require(path.join(globalRoot, 'playwright'));
    } catch {
      console.error('Playwright not found. Install it globally: npm i -g playwright && npx playwright install chromium');
      process.exit(2);
    }
  }
}
const { chromium } = loadPlaywright();

const CHROME_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const FAKE_CAM = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
// Console noise from MediaPipe/TFLite that is not an application error.
const BENIGN = /TensorFlow Lite|XNNPACK|gl_context|face_landmarker_graph|Graph successfully|OpenGL error checking|GPU stall|GL Driver Message|WebGL.*performance/i;

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, { timeout = 15000, message = 'condition' } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (err) {
    throw new Error(`Timed out waiting for ${message}: ${err.message.split('\n')[0]}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function httpOk(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

async function startServer() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.log('dist/ missing — building first…');
    execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
  }
  const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    if (await httpOk(`${BASE}/`)) return proc;
    if (proc.exitCode !== null) break;
    await sleep(150);
  }
  proc.kill();
  throw new Error(`vite preview did not start:\n${log}`);
}

async function ensurePortrait() {
  const file = path.join(FIXTURES, 'portrait.jpg');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(FIXTURES, { recursive: true });
  try {
    const res = await fetch(PORTRAIT_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch (err) {
    console.warn(`  (could not download test portrait: ${err.message})`);
    return null;
  }
}

/** Records every camera track the page acquires, so tests can check cleanup. */
const TRACK_RECORDER = () => {
  window.__tracks = [];
  const md = navigator.mediaDevices;
  if (!md) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    window.__tracks.push(...s.getTracks());
    return s;
  };
  window.__liveTracks = () => window.__tracks.filter((t) => t.readyState === 'live').length;
};

const browsers = [];
async function launch(extraArgs = FAKE_CAM, options = {}) {
  const b = await chromium.launch({ args: [...CHROME_ARGS, ...extraArgs], ...options });
  browsers.push(b);
  return b;
}

async function newPage(browser, { permissions = ['camera'], init = [], path: p = '/' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions });
  for (const [fn, arg] of init) await context.addInitScript(fn, arg);
  const page = await context.newPage();
  page.errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
    pg.on('console', (m) => {
      if (m.type() === 'error' && !BENIGN.test(m.text())) page.errors.push(`console.error: ${m.text().slice(0, 300)}`);
    });
  };
  watch(page);
  context.on('page', watch);
  await page.goto(BASE + p);
  return { page, context };
}

const engineReady = (page) => waitFor(page, () => window.__fractalcam?.engine, null, { message: 'engine' });
const live = (page, timeout = 20000) =>
  waitFor(page, () => window.__fractalcam?.engine.sourceState === 'live', null, { timeout, message: 'source live' });

async function framesAdvance(page, min = 3, timeout = 15000) {
  const start = await page.evaluate(() => window.__fractalcam.engine.debugSample().frames);
  await waitFor(page, ([s, m]) => window.__fractalcam.engine.debugSample().frames >= s + m, [start, min], { timeout, message: `${min} new frames` });
}

const noErrors = (page) => assert(page.errors.length === 0, `page errors:\n  ${page.errors.join('\n  ')}`);

// ---------------------------------------------------------------- tests

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('app loads, all four shaders compile, and camera frames render through every effect', async () => {
  const b = await launch();
  const { page } = await newPage(b, { init: [[TRACK_RECORDER]] });
  await engineReady(page);
  await live(page);
  const { shaderErrors } = await page.evaluate(() => window.__fractalcam.engine.debugSample());
  assert(shaderErrors.length === 0, `shader errors: ${shaderErrors.join('\n')}`);
  const means = {};
  for (const fx of ['warp', 'kaleido', 'entity', 'glitch']) {
    await page.evaluate((fx) => window.__fractalcam.store.update({ effect: fx }), fx);
    await framesAdvance(page, 4);
    await sleep(600);
    const { sample } = await page.evaluate(() => window.__fractalcam.engine.debugSample());
    assert(sample.variance > 1, `${fx}: output is a flat color (variance ${sample.variance})`);
    assert(sample.mean.some((v) => v > 5), `${fx}: output is black`);
    means[fx] = sample.mean;
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.locator('[data-testid=stage]').screenshot({ path: path.join(ARTIFACTS, `effect-${fx}-fakecam.png`) });
  }
  // Effects must look different from each other.
  const ids = Object.keys(means);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const d = means[ids[i]].reduce((acc, v, k) => acc + Math.abs(v - means[ids[j]][k]), 0);
      assert(d > 6, `${ids[i]} and ${ids[j]} render nearly identically (Δ=${d.toFixed(1)})`);
    }
  const stats = await page.textContent('[data-testid=stats]');
  assert(/\d+ FPS/.test(stats) && /render \d+×\d+/.test(stats), `stats bar missing FPS/resolution: ${stats}`);
  noErrors(page);
  return `stats: ${stats.replace(/\s+/g, ' ')}`;
});

test('synthetic test-pattern mode exercises the pipeline and motion estimator', async () => {
  const b = await launch([]); // no fake camera at all
  const { page } = await newPage(b, { permissions: [] });
  await engineReady(page);
  await page.getByRole('button', { name: 'Use test pattern' }).click();
  await live(page);
  const status = await page.textContent('[data-testid=status]');
  assert(/SYNTHETIC TEST PATTERN/.test(status), `status should warn about synthetic mode: ${status}`);
  await waitFor(page, () => window.__fractalcam.engine.motion.result.energy > 0.01, null, { message: 'motion energy > 0' });
  await framesAdvance(page, 5);
  noErrors(page);
});

test('effect switching (keys 1–4 and buttons, rapid) never breaks rendering', async () => {
  const b = await launch();
  const { page } = await newPage(b);
  await engineReady(page);
  await live(page);
  const keys = '1234321442133241';
  for (const k of keys) {
    await page.keyboard.press(k);
    await sleep(40);
  }
  for (const id of ['glitch', 'warp', 'entity', 'kaleido']) await page.click(`[data-testid=effect-${id}]`);
  assert((await page.evaluate(() => window.__fractalcam.store.get().effect)) === 'kaleido', 'button selection');
  assert((await page.getAttribute('[data-testid=effect-kaleido]', 'aria-pressed')) === 'true', 'aria-pressed on active effect');
  await page.keyboard.press('3');
  assert((await page.evaluate(() => window.__fractalcam.store.get().effect)) === 'entity', 'key 3 selects Fractal Entity');
  await framesAdvance(page, 5);
  const st = await page.evaluate(() => window.__fractalcam.engine.status);
  assert(!st || st.code !== 'frame', `render error: ${st && st.text}`);
  noErrors(page);
});

test('parameter inputs stay within valid ranges (corrupt storage, sliders, randomize)', async () => {
  const RANGES = { intensity: [0, 2], speed: [0, 3], complexity: [1, 24], distortion: [0, 2], saturation: [0, 2], camMix: [0, 1], feedback: [0, 0.97], palette: [0, 7] };
  const b = await launch();
  const corrupt = () => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'fractalcam.settings.v1',
      JSON.stringify({ effect: 'warp', effects: { warp: { intensity: 999, speed: -4, complexity: 'lots', palette: 99, feedback: 5 } }, fpsCap: 7 }),
    );
  };
  const { page } = await newPage(b, { init: [[corrupt]] });
  await engineReady(page);
  const check = async (label) => {
    const all = await page.evaluate(() => window.__fractalcam.store.get());
    for (const [fx, p] of Object.entries(all.effects))
      for (const [k, [lo, hi]] of Object.entries(RANGES))
        assert(typeof p[k] === 'number' && p[k] >= lo && p[k] <= hi, `${label}: ${fx}.${k}=${p[k]} outside [${lo},${hi}]`);
    assert(all.fpsCap === 30 || all.fpsCap === 60, `${label}: fpsCap ${all.fpsCap}`);
  };
  await check('after loading corrupt storage');
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (k === 'palette') continue;
    const sel = `[data-testid=slider-${k}]`;
    assert(Number(await page.getAttribute(sel, 'min')) === lo && Number(await page.getAttribute(sel, 'max')) === hi, `${k} slider bounds`);
    await page.focus(sel);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    assert((await page.evaluate((k) => window.__fractalcam.store.activeParams()[k], k)) === hi, `${k} slider max`);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    assert((await page.evaluate((k) => window.__fractalcam.store.activeParams()[k], k)) === lo, `${k} slider min`);
  }
  await page.locator('body').click({ position: { x: 5, y: 880 } });
  for (const fx of ['1', '2', '3', '4']) {
    await page.keyboard.press(fx);
    for (let i = 0; i < 15; i++) await page.keyboard.press('r');
  }
  await check('after randomize');
  // Persisted values reload intact.
  await sleep(400);
  await page.reload();
  await engineReady(page);
  await check('after reload');
  noErrors(page);
});

test('blocked camera permission is handled gracefully', async () => {
  // Full Chromium (not the headless shell) has the real permission machinery.
  const b = await launch(['--use-fake-device-for-media-stream'], { channel: 'chromium' });
  const context = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // Deny camera for this origin exactly as the user clicking "Block" would.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setPermission', { origin: BASE, permission: { name: 'camera' }, setting: 'denied' });
  await page.goto(BASE + '/');
  await engineReady(page);
  await page.waitForSelector('[data-testid=start-overlay], [data-testid=error-overlay]');
  if (await page.isVisible('[data-testid=enable-camera]')) await page.click('[data-testid=enable-camera]');
  await page.waitForSelector('[data-testid=error-overlay]', { timeout: 15000 });
  const text = await page.textContent('[data-testid=error-overlay]');
  assert(/blocked/i.test(text) && /Allow/.test(text), `denied message should explain how to allow: ${text}`);
  assert((await page.getAttribute('[data-testid=status]', 'class')).includes('error'), 'status area shows error');
  // Recovery path still works.
  await page.getByRole('button', { name: 'Use test pattern' }).click();
  await live(page);
  noErrors(page);
});

test('missing camera / camera in use produce specific messages', async () => {
  const b = await launch([]);
  for (const [name, expected] of [
    ['NotFoundError', /No camera was found/],
    ['NotReadableError', /could not be started/],
  ]) {
    const fail = (n) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('simulated', n));
    };
    const { page, context } = await newPage(b, { init: [[fail, name]], permissions: [] });
    await engineReady(page);
    await page.waitForSelector('[data-testid=start-overlay], [data-testid=error-overlay]');
    if (await page.isVisible('[data-testid=enable-camera]')) await page.click('[data-testid=enable-camera]');
    await page.waitForSelector('[data-testid=error-overlay]');
    const text = await page.textContent('[data-testid=error-overlay]');
    assert(expected.test(text), `${name}: unexpected message: ${text}`);
    noErrors(page);
    await context.close();
  }
});

test('/output route renders the effect with no controls, text or cursor', async () => {
  const b = await launch();
  const { page } = await newPage(b, { path: '/output' });
  await engineReady(page);
  await live(page);
  await framesAdvance(page, 5);
  const info = await page.evaluate(() => ({
    interactive: document.querySelectorAll('button, input, select, a, textarea, [role=button]').length,
    text: document.body.innerText.trim(),
    cursor: getComputedStyle(document.body).cursor,
    canvases: document.querySelectorAll('canvas').length,
    rect: document.querySelector('canvas').getBoundingClientRect().toJSON(),
    title: document.title,
  }));
  assert(info.interactive === 0, `output has ${info.interactive} interactive elements`);
  assert(info.text === '', `output shows text: "${info.text}"`);
  assert(info.cursor === 'none', `cursor is ${info.cursor}`);
  assert(info.canvases === 1, 'exactly one canvas');
  assert(info.rect.width === 1440 && info.rect.height === 900, `canvas should fill the window: ${JSON.stringify(info.rect)}`);
  assert(info.title === 'FractalCam Output', 'window title used for OBS window selection');
  const { sample } = await page.evaluate(() => window.__fractalcam.engine.debugSample());
  assert(sample.variance > 1, 'output has content');
  await page.screenshot({ path: path.join(ARTIFACTS, 'output-route.png') });
  noErrors(page);
});

test('camera acquisition, device switching, output-window hand-off and cleanup', async () => {
  const b = await launch();
  const { page, context } = await newPage(b, { init: [[TRACK_RECORDER]] });
  await engineReady(page);
  await live(page);
  assert((await page.evaluate(() => window.__liveTracks())) === 1, 'one live camera track');

  // Switch to the synthetic source: the camera must be released.
  await page.selectOption('[data-testid=device-select]', 'synthetic');
  await waitFor(page, () => window.__fractalcam.engine.source?.kind === 'synthetic', null, { message: 'synthetic source' });
  assert((await page.evaluate(() => window.__liveTracks())) === 0, 'camera released after switching to test pattern');

  // Back to the camera.
  await page.selectOption('[data-testid=device-select]', '');
  await waitFor(page, () => window.__fractalcam.engine.source?.kind === 'camera', null, { message: 'camera source again' });
  assert((await page.evaluate(() => window.__liveTracks())) === 1, 'exactly one live track after switching back');

  // Open the clean output window: it takes over the camera, the panel releases it and mirrors.
  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('[data-testid=open-output]')]);
  await engineReady(popup);
  await live(popup);
  await waitFor(page, () => window.__fractalcam.engine.sourceState === 'suspended', null, { message: 'control suspended' });
  assert((await page.evaluate(() => window.__liveTracks())) === 0, 'control window released its camera');
  assert((await popup.evaluate(() => window.__liveTracks())) === 1, 'output window holds one camera track');
  await waitFor(page, () => {
    const v = document.querySelector('video.mirror');
    return v && !v.classList.contains('hidden') && v.videoWidth > 0;
  }, null, { message: 'preview mirrors the output window' });
  assert(/OUTPUT WINDOW/.test(await page.textContent('[data-testid=stats]')), 'stats show output window');

  // Parameters sync from panel to output.
  await page.keyboard.press('4');
  await waitFor(popup, () => window.__fractalcam.store.get().effect === 'glitch', null, { message: 'effect synced to output' });
  await page.focus('[data-testid=slider-intensity]');
  await page.keyboard.press('End');
  await waitFor(popup, () => window.__fractalcam.store.activeParams().intensity === 2, null, { message: 'slider synced to output' });
  // ...and shortcuts pressed in the output window sync back.
  await popup.keyboard.press('2');
  await waitFor(page, () => window.__fractalcam.store.get().effect === 'kaleido', null, { message: 'effect synced back to panel' });

  // Closing the output window hands the camera back.
  await popup.close({ runBeforeUnload: true });
  await live(page, 15000);
  assert((await page.evaluate(() => window.__liveTracks())) === 1, 'control re-acquired exactly one track');

  // Disposing the engine releases everything.
  await page.evaluate(() => window.__fractalcam.engine.dispose());
  assert((await page.evaluate(() => window.__liveTracks())) === 0, 'dispose releases the camera');
  noErrors(page);
});

test('keyboard shortcuts: Space pause, R randomize, H hide UI, F fullscreen', async () => {
  const b = await launch();
  const { page } = await newPage(b);
  await engineReady(page);
  await live(page);
  await page.keyboard.press('Space');
  assert(await page.evaluate(() => window.__fractalcam.store.get().paused), 'Space pauses');
  const t0 = await page.evaluate(() => window.__fractalcam.engine.time);
  await sleep(600);
  assert((await page.evaluate(() => window.__fractalcam.engine.time)) === t0, 'procedural time frozen while paused');
  await page.keyboard.press('Space');
  await sleep(600);
  assert((await page.evaluate(() => window.__fractalcam.engine.time)) > t0, 'time resumes');

  const before = await page.evaluate(() => JSON.stringify(window.__fractalcam.store.activeParams()));
  await page.keyboard.press('r');
  assert((await page.evaluate(() => JSON.stringify(window.__fractalcam.store.activeParams()))) !== before, 'R randomizes');
  await page.click('[data-testid=reset]');
  const def = await page.evaluate(() => window.__fractalcam.store.activeParams().intensity);
  assert(def === 1, 'reset restores defaults');

  await page.keyboard.press('h');
  assert(!(await page.isVisible('[data-testid=panel]')), 'H hides the panel');
  await page.keyboard.press('h');
  assert(await page.isVisible('[data-testid=panel]'), 'H shows the panel again');

  await page.keyboard.press('f');
  await waitFor(page, () => document.fullscreenElement?.dataset.testid === 'stage', null, { message: 'fullscreen stage' });
  const fs1 = await page.evaluate(() => ({
    overlays: document.querySelectorAll('[data-testid=stage] .overlay, [data-testid=stage] .badge').length,
    cursor: getComputedStyle(document.querySelector('[data-testid=stage]')).cursor,
  }));
  assert(fs1.overlays === 0 && fs1.cursor === 'none', `fullscreen output must be clean: ${JSON.stringify(fs1)}`);
  await page.keyboard.press('f');
  await waitFor(page, () => !document.fullscreenElement, null, { message: 'exit fullscreen' });
  noErrors(page);
});

test('WebGL unavailable falls back to the plain camera with a clear message', async () => {
  const b = await launch();
  const noWebGL = () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/.test(type)) return null;
      return orig.call(this, type, ...rest);
    };
  };
  const { page } = await newPage(b, { init: [[noWebGL]] });
  await engineReady(page);
  await waitFor(page, () => window.__fractalcam.engine.fallback, null, { message: 'fallback flag' });
  await live(page);
  assert(await page.isVisible('video.fallback-video'), 'fallback video visible');
  assert(/WebGL/.test(await page.textContent('[data-testid=status]')), 'status explains WebGL problem');
});

test('face tracking: MediaPipe finds a real face and head roll drives the signals', async () => {
  const portrait = await ensurePortrait();
  if (!portrait) return 'SKIPPED (no network for test portrait)';
  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(portrait).toString('base64')}`;
  // A "camera" that shows a real portrait, rotated by window.__roll.
  const portraitCam = (src) => {
    window.__roll = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 960;
      c.height = 540;
      const g = c.getContext('2d');
      setInterval(() => {
        g.fillStyle = '#334';
        g.fillRect(0, 0, c.width, c.height);
        g.save();
        g.translate(480, 230);
        g.rotate(window.__roll);
        const h = 820;
        const w = (img.width / img.height) * h;
        g.drawImage(img, -w / 2, -h * 0.2, w, h);
        g.restore();
      }, 33);
      return c.captureStream(30);
    };
  };
  const b = await launch([]);
  const { page } = await newPage(b, { init: [[portraitCam, dataUrl]], path: '/?tracker=cpu' });
  await engineReady(page);
  await page.evaluate(() => window.__fractalcam.store.update({ faceTracking: true, deviceId: '' }));
  await page.click('[data-testid=enable-camera]').catch(() => {});
  await live(page);
  await waitFor(page, () => window.__fractalcam.engine.tracking.signals.facePresent > 0.8, null, { timeout: 90000, message: 'face detected' });
  const sig = await page.evaluate(() => ({ ...window.__fractalcam.engine.tracking.signals }));
  assert(sig.faceX > 0.3 && sig.faceX < 0.7 && sig.faceY > 0.1 && sig.faceY < 0.6, `face position plausible: ${sig.faceX},${sig.faceY}`);
  assert(sig.smile > 0.3, `smiling portrait should register a smile (${sig.smile.toFixed(2)})`);

  const rollAt = async (r) => {
    await page.evaluate((r) => (window.__roll = r), r);
    await sleep(3500);
    return page.evaluate(() => window.__fractalcam.engine.tracking.signals.roll);
  };
  const plus = await rollAt(0.4);
  const minus = await rollAt(-0.4);
  assert(Math.sign(plus) !== Math.sign(minus) && Math.abs(plus) > 0.15 && Math.abs(minus) > 0.15, `head roll should follow rotation (got ${plus.toFixed(2)}, ${minus.toFixed(2)})`);
  const status = await page.textContent('[data-testid=stats]');
  assert(/face ✓/.test(status), `stats should show face tracked: ${status}`);

  // Body tracking can be enabled live without breaking face tracking.
  await page.click('[data-testid=toggle-pose] + .track');
  await waitFor(page, () => /body/.test(window.__fractalcam.engine.tracking.status()), null, { timeout: 60000, message: 'pose tracker ready' });
  assert(!/unavailable/.test(await page.evaluate(() => window.__fractalcam.engine.tracking.status())), 'pose tracker loads');
  await page.locator('[data-testid=stage]').screenshot({ path: path.join(ARTIFACTS, 'face-tracking.png') });
  noErrors(page);
  return `roll +0.4rad → ${plus.toFixed(2)}, −0.4rad → ${minus.toFixed(2)}; smile ${sig.smile.toFixed(2)}; ${await page.evaluate(() => window.__fractalcam.engine.tracking.status())}`;
});

// ---------------------------------------------------------------- runner

(async () => {
  const only = process.argv[2];
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = await startServer();
  let failed = 0;
  const t0 = Date.now();
  try {
    for (const t of tests) {
      if (only && !t.name.includes(only)) continue;
      const start = Date.now();
      try {
        const note = await t.fn();
        console.log(`  ✓ ${t.name} (${((Date.now() - start) / 1000).toFixed(1)}s)${note ? `\n      ${note}` : ''}`);
      } catch (err) {
        failed++;
        console.log(`  ✗ ${t.name}\n      ${String(err.message).split('\n').join('\n      ')}`);
      } finally {
        while (browsers.length) await browsers.pop().close().catch(() => {});
      }
    }
  } finally {
    server.kill();
  }
  console.log(`\n${failed ? `${failed} FAILED` : 'All browser tests passed'} in ${((Date.now() - t0) / 1000).toFixed(0)}s. Screenshots: tests/e2e/artifacts/`);
  process.exit(failed ? 1 : 0);
})();
