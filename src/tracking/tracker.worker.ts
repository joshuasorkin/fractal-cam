/// <reference lib="webworker" />
// MediaPipe inference runs here, off the main thread, so rendering never waits on it.

import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { FaceFrame, PoseFrame } from './signals';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let face: FaceLandmarker | null = null;
let pose: PoseLandmarker | null = null;
let lastTs = 0;

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

async function create<T>(
  label: string,
  preferred: 'auto' | 'CPU' | 'GPU',
  factory: (delegate: 'GPU' | 'CPU') => Promise<T>,
): Promise<{ task: T; delegate: 'GPU' | 'CPU' }> {
  if (preferred !== 'auto') return { task: await factory(preferred), delegate: preferred };
  try {
    return { task: await factory('GPU'), delegate: 'GPU' };
  } catch (gpuErr) {
    console.warn(`[tracker] ${label} GPU delegate failed, falling back to CPU`, gpuErr);
    return { task: await factory('CPU'), delegate: 'CPU' };
  }
}

async function init(req: Extract<WorkerRequest, { type: 'init' }>) {
  const base = await FilesetResolver.forVisionTasks(req.wasmBase, true);
  // In a module worker MediaPipe loads its WASM glue with import(), which is
  // cached: a second task would find no ModuleFactory. A per-task query string
  // makes each task evaluate its own copy of the loader.
  const fileset = (task: string) => ({ ...base, wasmLoaderPath: `${base.wasmLoaderPath}?task=${task}` });
  const canvasFor = (d: 'GPU' | 'CPU') => (d === 'GPU' && typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined);
  const delegates: string[] = [];
  if (req.face) {
    const r = await create('face', req.delegate, (delegate) =>
      FaceLandmarker.createFromOptions(fileset('face'), {
        baseOptions: { modelAssetPath: req.faceModel, delegate },
        canvas: canvasFor(delegate),
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      }),
    );
    face = r.task;
    delegates.push(`face:${r.delegate}`);
  }
  if (req.pose) {
    const r = await create('pose', req.delegate, (delegate) =>
      PoseLandmarker.createFromOptions(fileset('pose'), {
        baseOptions: { modelAssetPath: req.poseModel, delegate },
        canvas: canvasFor(delegate),
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    );
    pose = r.task;
    delegates.push(`pose:${r.delegate}`);
  }
  post({ type: 'ready', delegates });
}

function runFace(bitmap: ImageBitmap, ts: number): FaceFrame | null {
  if (!face) return null;
  const res = face.detectForVideo(bitmap, ts);
  const lm = res.faceLandmarks?.[0];
  if (!lm || lm.length < 300) return null;
  const blend: Record<string, number> = {};
  for (const c of res.faceBlendshapes?.[0]?.categories ?? []) blend[c.categoryName] = c.score;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const m = res.facialTransformationMatrixes?.[0]?.data;
  return {
    blend,
    matrix: m ? Array.from(m) : null,
    nose: [lm[1].x, lm[1].y],
    // 33 / 263: outer eye corners.
    eyes: [(lm[33].x + lm[263].x) / 2, (lm[33].y + lm[263].y) / 2],
    bbox: [minX, minY, maxX, maxY],
  };
}

function runPose(bitmap: ImageBitmap, ts: number): PoseFrame | null {
  if (!pose) return null;
  const res = pose.detectForVideo(bitmap, ts);
  const lm = res.landmarks?.[0];
  if (!lm) return null;
  const pt = (i: number): [number, number, number] => [lm[i].x, lm[i].y, lm[i].visibility ?? 1];
  return { leftShoulder: pt(11), rightShoulder: pt(12), leftWrist: pt(15), rightWrist: pt(16) };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'init') {
      await init(req);
    } else if (req.type === 'frame') {
      const ts = Math.max(lastTs + 1, Math.round(performance.now()));
      lastTs = ts;
      const t0 = performance.now();
      try {
        const faceRes = req.runFace ? runFace(req.bitmap, ts) : undefined;
        const poseRes = req.runPose ? runPose(req.bitmap, ts) : undefined;
        post({ type: 'result', id: req.id, face: faceRes, pose: poseRes, ms: performance.now() - t0 });
      } finally {
        req.bitmap.close();
      }
    } else if (req.type === 'dispose') {
      face?.close();
      pose?.close();
      face = pose = null;
      self.close();
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), id: req.type === 'frame' ? req.id : undefined });
  }
};
