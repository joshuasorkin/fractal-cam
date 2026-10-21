// Main-thread side of tracking: feeds downscaled frames to the worker at a modest
// rate (never more than one in flight) and exposes smoothed signals.

import { SignalSmoother, type TrackingSignals } from './signals';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface TrackingConfig {
  face: boolean;
  pose: boolean;
}

const INFER_WIDTH = 480;
const MIN_INTERVAL_MS = 1000 / 24;

/** `?tracker=cpu` / `?tracker=gpu` forces a MediaPipe delegate (troubleshooting). */
function preferredDelegate(): 'auto' | 'CPU' | 'GPU' {
  const v = new URLSearchParams(location.search).get('tracker')?.toUpperCase();
  return v === 'CPU' || v === 'GPU' ? v : 'auto';
}

function assetUrl(path: string) {
  return new URL(import.meta.env.BASE_URL + path, location.href).href;
}

export class TrackingClient {
  private worker: Worker | null = null;
  private config: TrackingConfig = { face: false, pose: false };
  private video: HTMLVideoElement | null = null;
  private ready = false;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frameId = 0;
  private generation = 0;
  private delegates: string[] = [];
  private failed: string | null = null;
  private seenFace = false;
  readonly smoother = new SignalSmoother();
  inferenceMs = 0;

  get signals(): TrackingSignals {
    return this.smoother.signals;
  }

  status(): string {
    if (!this.config.face && !this.config.pose) return 'off';
    if (this.failed) return `unavailable (${this.failed})`;
    if (!this.ready) return 'loading models…';
    const s = this.smoother.signals;
    const parts: string[] = [];
    if (this.config.face) parts.push(s.facePresent > 0.5 ? 'face ✓' : this.seenFace ? 'face lost' : 'searching for face');
    if (this.config.pose) parts.push(s.posePresent > 0.5 ? 'body ✓' : 'body —');
    return `${parts.join(' · ')} (${this.delegates.join(', ')}, ${this.inferenceMs.toFixed(0)} ms)`;
  }

  setVideo(video: HTMLVideoElement | null) {
    this.video = video;
    this.smoother.clear();
  }

  configure(config: TrackingConfig) {
    if (config.face === this.config.face && config.pose === this.config.pose) return;
    this.config = { ...config };
    this.restartWorker();
  }

  private restartWorker() {
    this.stopWorker();
    this.smoother.clear();
    if (!this.config.face && !this.config.pose) return;
    const gen = ++this.generation;
    try {
      this.worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module', name: 'fractalcam-tracker' });
    } catch (err) {
      this.failed = `worker: ${(err as Error).message}`;
      return;
    }
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (gen !== this.generation) return;
      this.onMessage(e.data);
    };
    this.worker.onerror = (e) => {
      if (gen !== this.generation) return;
      this.failed = e.message || 'worker crashed';
      this.busy = false;
    };
    const req: WorkerRequest = {
      type: 'init',
      wasmBase: assetUrl('mediapipe/wasm'),
      faceModel: assetUrl('models/face_landmarker.task'),
      poseModel: assetUrl('models/pose_landmarker_lite.task'),
      face: this.config.face,
      pose: this.config.pose,
      delegate: preferredDelegate(),
    };
    this.worker.postMessage(req);
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === 'ready') {
      this.ready = true;
      this.delegates = msg.delegates;
      this.schedule(0);
    } else if (msg.type === 'result') {
      this.busy = false;
      this.inferenceMs = this.inferenceMs ? this.inferenceMs * 0.8 + msg.ms * 0.2 : msg.ms;
      // On slow machines results arrive rarely; don't call the face "lost" between them.
      this.smoother.holdSeconds = Math.max(0.5, (this.inferenceMs / 1000) * 2.5);
      const now = performance.now() / 1000;
      if (msg.face) this.seenFace = true;
      this.smoother.pushFace(msg.face ?? null, now);
      this.smoother.pushPose(msg.pose ?? null, now);
      // Back off if inference is slow so it never hogs the shared GPU/CPU.
      this.schedule(Math.max(MIN_INTERVAL_MS, this.inferenceMs * 1.5) - msg.ms);
    } else if (msg.type === 'error') {
      this.busy = false;
      if (!this.ready) {
        this.failed = msg.message.includes('404') || /fetch|load/i.test(msg.message)
          ? 'models missing — run `npm run assets`'
          : msg.message.slice(0, 120);
      } else {
        this.schedule(250);
      }
    }
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sendFrame(), Math.max(0, delay));
  }

  private async sendFrame() {
    this.timer = null;
    const video = this.video;
    const worker = this.worker;
    if (!worker || !this.ready || this.busy) return;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      this.schedule(200);
      return;
    }
    this.busy = true;
    const gen = this.generation;
    try {
      const h = Math.round((INFER_WIDTH * video.videoHeight) / video.videoWidth);
      const bitmap = await createImageBitmap(video, { resizeWidth: INFER_WIDTH, resizeHeight: h, resizeQuality: 'low' });
      if (gen !== this.generation || this.worker !== worker) {
        bitmap.close();
        return;
      }
      const id = ++this.frameId;
      // When both models run, pose (less expressive, more expensive) runs every other frame.
      const runPose = this.config.pose && (!this.config.face || id % 2 === 0);
      const req: WorkerRequest = { type: 'frame', id, bitmap, runFace: this.config.face, runPose };
      worker.postMessage(req, [bitmap]);
    } catch {
      this.busy = false;
      this.schedule(200);
    }
  }

  /** Advance smoothing; call once per rendered frame. */
  tick(dt: number) {
    this.smoother.tick(performance.now() / 1000, dt);
  }

  private stopWorker() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' } satisfies WorkerRequest);
      const w = this.worker;
      setTimeout(() => w.terminate(), 500);
    }
    this.worker = null;
    this.ready = false;
    this.busy = false;
    this.failed = null;
    this.seenFace = false;
    this.delegates = [];
    this.inferenceMs = 0;
  }

  dispose() {
    this.config = { face: false, pose: false };
    this.stopWorker();
    this.video = null;
  }
}
