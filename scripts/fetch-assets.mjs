#!/usr/bin/env node
// Copies the MediaPipe WASM runtime out of node_modules and downloads the face /
// pose models into public/, so the app runs with no network access afterwards.
// Never fails the install: tracking simply reports "models missing" if absent.

import { copyFile, mkdir, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelsDst = join(root, 'public/models');

const MODELS = {
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

async function copyWasm() {
  if (!existsSync(wasmSrc)) {
    console.warn('[assets] @mediapipe/tasks-vision not installed yet; skipping WASM copy');
    return;
  }
  await mkdir(wasmDst, { recursive: true });
  for (const f of await readdir(wasmSrc)) await copyFile(join(wasmSrc, f), join(wasmDst, f));
  console.log(`[assets] MediaPipe WASM -> public/mediapipe/wasm`);
}

async function download(name, url) {
  const dst = join(modelsDst, name);
  if (existsSync(dst) && (await stat(dst)).size > 100_000) {
    console.log(`[assets] ${name} already present`);
    return true;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dst + '.part', buf);
    await rename(dst + '.part', dst);
    console.log(`[assets] downloaded ${name} (${(buf.length / 1e6).toFixed(1)} MB)`);
    return true;
  } catch (err) {
    console.warn(`[assets] could not download ${name}: ${err.message}. Face/body tracking will be unavailable until you rerun "npm run assets".`);
    return false;
  }
}

await copyWasm();
await mkdir(modelsDst, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) await download(name, url);
