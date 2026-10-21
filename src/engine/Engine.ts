// Orchestrates source -> motion/tracking -> renderer on a requestAnimationFrame
// loop. Lives outside React: the UI only receives throttled stats and status.

import { Renderer, WebGLUnavailableError } from './Renderer';
import { AdaptiveQuality, FpsCounter } from './PerfMonitor';
import { computeCamUV, videoToOutput } from './cameraMapping';
import { MotionEstimator } from '../motion/MotionEstimator';
import { TrackingClient } from '../tracking/TrackingClient';
import { openCamera, describeCameraError, type VideoSource } from '../capture/camera';
import { openSyntheticSource } from '../capture/syntheticSource';
import { PALETTES } from '../params/palettes';
import { SYNTHETIC_DEVICE, type Settings } from '../params/params';
import type { SettingsStore } from '../params/store';

export const OUTPUT_WIDTH = 1280;
export const OUTPUT_HEIGHT = 720;

export interface EngineStats {
  fps: number;
  renderWidth: number;
  renderHeight: number;
  outputWidth: number;
  outputHeight: number;
  cameraWidth: number;
  cameraHeight: number;
  source: string;
  tracking: string;
  motion: number;
  inferenceMs: number;
  frames: number;
}

export type StatusLevel = 'info' | 'warn' | 'error';
export interface EngineStatus {
  level: StatusLevel;
  text: string;
  /** Machine-readable reason, e.g. camera error code. */
  code?: string;
}

export type SourceState = 'idle' | 'starting' | 'live' | 'error' | 'suspended';

export class Engine {
  renderer: Renderer | null = null;
  readonly motion = new MotionEstimator(64, 36);
  readonly tracking = new TrackingClient();
  source: VideoSource | null = null;
  sourceState: SourceState = 'idle';
  status: EngineStatus | null = null;
  stats: EngineStats;
  /** Set when WebGL2 is unavailable: the raw camera is shown with CSS effects instead. */
  fallback = false;

  private rafId = 0;
  private running = false;
  private lastFrame = 0;
  private lastRendered = 0;
  private time = 0;
  private frames = 0;
  private fps = new FpsCounter();
  private adaptive: AdaptiveQuality;
  private sourceToken = 0;
  private wantedDevice: string | null = null;
  private lastStatsEmit = 0;
  private unsubscribe: () => void;
  private statusListeners = new Set<(s: EngineStatus | null) => void>();
  private statsListeners = new Set<(s: EngineStats) => void>();
  private stateListeners = new Set<(s: SourceState) => void>();
  private settings: Settings;
  private pendingScale: number | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    store: SettingsStore,
  ) {
    this.settings = store.get();
    this.adaptive = new AdaptiveQuality(this.settings.renderScale);
    this.stats = this.emptyStats();
    this.unsubscribe = store.subscribe(() => this.onSettings(store.get()));
  }

  private emptyStats(): EngineStats {
    return {
      fps: 0,
      renderWidth: this.renderer?.renderWidth ?? 0,
      renderHeight: this.renderer?.renderHeight ?? 0,
      outputWidth: OUTPUT_WIDTH,
      outputHeight: OUTPUT_HEIGHT,
      cameraWidth: 0,
      cameraHeight: 0,
      source: 'none',
      tracking: 'off',
      motion: 0,
      inferenceMs: 0,
      frames: 0,
    };
  }

  // ---- events ---------------------------------------------------------------

  onStatus(fn: (s: EngineStatus | null) => void) {
    this.statusListeners.add(fn);
    return () => void this.statusListeners.delete(fn);
  }
  onStats(fn: (s: EngineStats) => void) {
    this.statsListeners.add(fn);
    return () => void this.statsListeners.delete(fn);
  }
  onSourceState(fn: (s: SourceState) => void) {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  }

  /** Renderer problems (no WebGL, shader errors) outrank transient source messages. */
  private rendererStatus: EngineStatus | null = null;

  private setStatus(s: EngineStatus | null) {
    if (this.rendererStatus && (!s || s.level !== 'error')) s = this.rendererStatus;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
  private setSourceState(s: SourceState) {
    this.sourceState = s;
    for (const l of this.stateListeners) l(s);
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Create GPU resources and start the render loop (no camera yet). */
  init(): boolean {
    if (this.renderer || this.fallback) return !this.fallback;
    try {
      this.renderer = new Renderer(this.canvas, OUTPUT_WIDTH, OUTPUT_HEIGHT, { data: this.motion.map, width: this.motion.width, height: this.motion.height });
      const errors = this.renderer.compileAll();
      if (errors.length) {
        this.rendererStatus = { level: 'error', text: `Shader compilation failed:\n${errors[0]}`, code: 'shader' };
        this.setStatus(this.rendererStatus);
      }
      this.applyRenderScale();
    } catch (err) {
      this.renderer = null;
      this.fallback = true;
      const msg = err instanceof WebGLUnavailableError ? err.message : `Renderer failed: ${(err as Error).message}`;
      this.rendererStatus = {
        level: 'error',
        text: `${msg}. Showing the plain camera with a CSS fallback. Enable "Use graphics acceleration when available" in browser settings.`,
        code: 'webgl',
      };
      this.setStatus(this.rendererStatus);
    }
    this.configureTracking();
    this.start();
    return !this.fallback;
  }

  private start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.fps.reset();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Acquire the configured video source (camera or synthetic). */
  async startSource(): Promise<void> {
    const device = this.settings.deviceId;
    const token = ++this.sourceToken;
    this.wantedDevice = device;
    this.releaseSourceOnly();
    this.setSourceState('starting');
    this.setStatus({ level: 'info', text: device === SYNTHETIC_DEVICE ? 'Starting synthetic test pattern…' : 'Starting camera…' });
    try {
      const src = device === SYNTHETIC_DEVICE ? await openSyntheticSource() : await openCamera(device);
      if (token !== this.sourceToken) {
        src.stop(); // superseded by a newer request
        return;
      }
      this.source = src;
      src.stream.getVideoTracks()[0]?.addEventListener('ended', this.onTrackEnded);
      this.renderer?.setVideo(src.video);
      this.tracking.setVideo(src.video);
      this.motion.reset();
      this.attachFallbackVideo();
      this.setSourceState('live');
      this.setStatus(
        src.kind === 'synthetic'
          ? { level: 'warn', text: 'Using the SYNTHETIC TEST PATTERN, not your webcam. Choose your webcam in the Camera section to go live.', code: 'synthetic' }
          : null,
      );
      this.start();
    } catch (err) {
      if (token !== this.sourceToken) return;
      const e = describeCameraError(err);
      this.setSourceState('error');
      this.setStatus({ level: 'error', text: e.message, code: e.code });
    }
  }

  private onTrackEnded = () => {
    this.setSourceState('error');
    this.setStatus({ level: 'error', text: 'The camera stopped (unplugged, or taken by another app). Press Retry.', code: 'ended' });
  };

  private releaseSourceOnly() {
    if (this.source) {
      this.source.stream.getVideoTracks()[0]?.removeEventListener('ended', this.onTrackEnded);
      this.source.stop();
      this.source.video.remove();
    }
    this.source = null;
    this.renderer?.setVideo(null);
    this.tracking.setVideo(null);
  }

  /** Release the camera and pause rendering (e.g. while the output window owns the camera). */
  suspend() {
    this.sourceToken++;
    this.releaseSourceOnly();
    this.tracking.dispose();
    this.stop();
    this.setSourceState('suspended');
    this.setStatus(null);
  }

  async resume() {
    this.configureTracking();
    this.start();
    await this.startSource();
  }

  dispose() {
    this.sourceToken++;
    this.stop();
    this.unsubscribe();
    this.releaseSourceOnly();
    this.tracking.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.statusListeners.clear();
    this.statsListeners.clear();
    this.stateListeners.clear();
  }

  // ---- settings ---------------------------------------------------------------

  private onSettings(next: Settings) {
    const prev = this.settings;
    this.settings = next;
    if (next.faceTracking !== prev.faceTracking || next.poseTracking !== prev.poseTracking) this.configureTracking();
    if (next.adaptiveQuality !== prev.adaptiveQuality || next.renderScale !== prev.renderScale) {
      if (!next.adaptiveQuality) this.adaptive = new AdaptiveQuality(next.renderScale);
      this.applyRenderScale();
    }
    if (!next.motionResponsive && prev.motionResponsive) this.motion.reset();
    if (next.deviceId !== prev.deviceId && this.sourceState !== 'suspended' && this.wantedDevice !== null) {
      void this.startSource();
    }
  }

  private configureTracking() {
    if (this.fallback) return;
    this.tracking.configure({ face: this.settings.faceTracking, pose: this.settings.poseTracking });
  }

  /** Resizing render targets clears them, so it is deferred to the start of the next frame. */
  private applyRenderScale() {
    this.pendingScale = this.settings.adaptiveQuality ? this.adaptive.scale : this.settings.renderScale;
    if (!this.running) this.flushRenderScale();
  }

  private flushRenderScale() {
    if (this.pendingScale === null) return;
    this.renderer?.setRenderScale(this.pendingScale);
    this.pendingScale = null;
  }

  // ---- frame loop -------------------------------------------------------------

  private loop = (now: number) => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    // Frame cap (30 fps is all Zoom needs and halves GPU load on 60 Hz displays).
    const minInterval = 1000 / this.settings.fpsCap;
    if (now - this.lastRendered < minInterval - 2) return;
    this.lastRendered = now;

    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    try {
      this.frame(now, dt);
    } catch (err) {
      // Never let one bad frame kill the loop; surface the error once.
      if (this.status?.code !== 'frame') {
        this.setStatus({ level: 'error', text: `Render error: ${(err as Error).message}`, code: 'frame' });
      }
    }
  };

  private frame(now: number, dt: number) {
    const s = this.settings;
    const params = s.effects[s.effect];
    const video = this.source?.video ?? null;
    this.flushRenderScale();

    if (video && s.motionResponsive) {
      this.motion.update(video, dt);
      if (this.motion.dirty) {
        this.renderer?.markMotionDirty();
        this.motion.dirty = false;
      }
    }
    this.tracking.tick(dt);
    const motion = s.motionResponsive ? this.motion.result.energy : 0;

    if (!s.paused) this.time += dt * params.speed * (1 + motion * 1.5);

    if (this.renderer) {
      const sig = this.tracking.signals;
      const camUV = computeCamUV(video?.videoWidth ?? 0, video?.videoHeight ?? 0, OUTPUT_WIDTH, OUTPUT_HEIGHT, s.mirror);
      const m = s.mirror ? -1 : 1;
      const face = videoToOutput(camUV, sig.faceX, sig.faceY);
      const eyes = videoToOutput(camUV, sig.eyeX, sig.eyeY);
      const lh = videoToOutput(camUV, sig.leftHandX, sig.leftHandY);
      const rh = videoToOutput(camUV, sig.rightHandX, sig.rightHandY);
      const mp = videoToOutput(camUV, this.motion.result.cx, this.motion.result.cy);
      this.renderer.render(s.effect, {
        time: this.time,
        params,
        palette: PALETTES[params.palette] ?? PALETTES[0],
        camUV,
        motion,
        motionPos: mp,
        face: [sig.mouth, sig.brow, sig.smile, sig.facePresent],
        head: [sig.yaw * m, sig.pitch, sig.roll * m],
        facePos: [face[0], face[1], sig.faceSize],
        pulse: [eyes[0], eyes[1], sig.pulse, sig.gazeX * m],
        hands: [lh[0], lh[1], rh[0], rh[1]],
        pose: [sig.armRaise, sig.posePresent],
      });
    }
    this.frames++;

    if (this.fps.frame(now)) {
      if (s.adaptiveQuality && this.source && this.adaptive.update(this.fps.fps, s.fpsCap, now)) this.applyRenderScale();
    }
    if (now - this.lastStatsEmit > 500) {
      this.lastStatsEmit = now;
      this.emitStats();
    }
  }

  private emitStats() {
    const v = this.source?.video;
    this.stats = {
      fps: this.fps.fps,
      renderWidth: this.renderer?.renderWidth ?? 0,
      renderHeight: this.renderer?.renderHeight ?? 0,
      outputWidth: OUTPUT_WIDTH,
      outputHeight: OUTPUT_HEIGHT,
      cameraWidth: v?.videoWidth ?? 0,
      cameraHeight: v?.videoHeight ?? 0,
      source: this.source ? this.source.label : this.sourceState,
      tracking: this.tracking.status(),
      motion: this.motion.result.energy,
      inferenceMs: this.tracking.inferenceMs,
      frames: this.frames,
    };
    for (const l of this.statsListeners) l(this.stats);
  }

  // ---- WebGL-less fallback ----------------------------------------------------

  private attachFallbackVideo() {
    if (!this.fallback || !this.source) return;
    const v = this.source.video;
    v.className = 'fallback-video';
    this.canvas.parentElement?.appendChild(v);
  }

  /** Test hook: frame counter and a pixel summary of the current render target. */
  debugSample() {
    return { frames: this.frames, sample: this.renderer?.sample() ?? null, shaderErrors: this.renderer?.shaderErrors ?? [] };
  }
}
