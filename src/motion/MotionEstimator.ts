// Frame-difference motion estimation on a tiny downsampled copy of the video.
// 64x36 = 2304 pixels per update, so the CPU cost is negligible.

export interface MotionResult {
  /** 0..1 smoothed global motion energy. */
  energy: number;
  /** Motion-weighted centroid in video coordinates (0..1, y down). */
  cx: number;
  cy: number;
}

/**
 * Pure core: compare two luma buffers, update a decaying per-cell motion map
 * (values 0..255, stored bottom-up to match GL texture orientation) and return
 * raw (unsmoothed) energy and centroid.
 */
export function computeMotion(
  prev: Float32Array,
  cur: Float32Array,
  map: Uint8Array,
  width: number,
  height: number,
  opts: { threshold?: number; gain?: number; decay?: number } = {},
): { raw: number; cx: number; cy: number } {
  const threshold = opts.threshold ?? 0.04;
  const gain = opts.gain ?? 6;
  const decay = opts.decay ?? 0.82;
  let sum = 0;
  let wx = 0;
  let wy = 0;
  for (let y = 0; y < height; y++) {
    const glRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = Math.abs(cur[i] - prev[i]);
      const m = d > threshold ? d - threshold : 0;
      sum += m;
      wx += m * x;
      wy += m * y;
      const v = Math.min(255, m * gain * 255);
      const j = glRow * width + x;
      map[j] = Math.max(v, map[j] * decay);
    }
  }
  const n = width * height;
  return {
    raw: sum / n,
    cx: sum > 1e-6 ? (wx / sum + 0.5) / width : 0.5,
    cy: sum > 1e-6 ? (wy / sum + 0.5) / height : 0.5,
  };
}

export class MotionEstimator {
  readonly width: number;
  readonly height: number;
  readonly map: Uint8Array;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private prev: Float32Array;
  private cur: Float32Array;
  private hasPrev = false;
  private lastVideoTime = -1;
  result: MotionResult = { energy: 0, cx: 0.5, cy: 0.5 };
  /** True when the map changed since the renderer last uploaded it. */
  dirty = false;

  constructor(width = 64, height = 36) {
    this.width = width;
    this.height = height;
    this.map = new Uint8Array(width * height);
    this.prev = new Float32Array(width * height);
    this.cur = new Float32Array(width * height);
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(width, height);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  }

  reset() {
    this.hasPrev = false;
    this.map.fill(0);
    this.result = { energy: 0, cx: 0.5, cy: 0.5 };
    this.dirty = true;
  }

  /** Call once per rendered frame; only does work when the video produced a new frame. */
  update(video: HTMLVideoElement, dt: number) {
    if (video.readyState < 2) return;
    if (video.currentTime === this.lastVideoTime) {
      // No new camera frame: let the map and energy fade instead of freezing.
      this.result.energy *= Math.exp(-dt * 2);
      return;
    }
    this.lastVideoTime = video.currentTime;
    this.ctx.drawImage(video, 0, 0, this.width, this.height);
    const px = this.ctx.getImageData(0, 0, this.width, this.height).data;
    for (let i = 0, j = 0; i < this.cur.length; i++, j += 4) {
      this.cur[i] = (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) / 255;
    }
    if (this.hasPrev) {
      const { raw, cx, cy } = computeMotion(this.prev, this.cur, this.map, this.width, this.height);
      // Map raw mean difference (~0..0.08 for vigorous movement) into 0..1, then smooth.
      const target = Math.min(1, raw * 18);
      const k = target > this.result.energy ? 0.5 : 0.12; // fast attack, slow release
      this.result.energy += (target - this.result.energy) * k;
      this.result.cx += (cx - this.result.cx) * 0.3;
      this.result.cy += (cy - this.result.cy) * 0.3;
      this.dirty = true;
    }
    [this.prev, this.cur] = [this.cur, this.prev];
    this.hasPrev = true;
  }
}
