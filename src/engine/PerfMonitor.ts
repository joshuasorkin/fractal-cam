// FPS measurement and adaptive render-scale control.

import { RENDER_SCALES } from '../params/params';

export class FpsCounter {
  private frames = 0;
  private windowStart = 0;
  fps = 0;

  /** Record a rendered frame at time `now` (ms). Returns true when fps was refreshed. */
  frame(now: number): boolean {
    // Count frame *intervals*: the frame that opens a window is its boundary, not a member.
    if (this.windowStart === 0) {
      this.windowStart = now;
      return false;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed >= 500) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.windowStart = now;
      return true;
    }
    return false;
  }

  reset() {
    this.frames = 0;
    this.windowStart = 0;
    this.fps = 0;
  }
}

/**
 * Steps the internal render scale down when the achieved frame rate stays below
 * target, and cautiously back up after a sustained period of headroom. A scale
 * that caused a drop is avoided for a while to prevent oscillation.
 */
export class AdaptiveQuality {
  levelIndex: number;
  private lowSince: number | null = null;
  private goodSince: number | null = null;
  private blockedUntil = new Map<number, number>();

  constructor(
    initialScale = 0.85,
    private opts = { lowRatio: 0.88, downAfterMs: 2000, upAfterMs: 8000, blockMs: 30000 },
  ) {
    const i = RENDER_SCALES.findIndex((s) => Math.abs(s - initialScale) < 1e-6);
    this.levelIndex = i >= 0 ? i : 1;
  }

  get scale(): number {
    return RENDER_SCALES[this.levelIndex];
  }

  /** Feed a measured fps sample; returns true if the scale changed. */
  update(fps: number, targetFps: number, now: number): boolean {
    if (fps <= 0) return false;
    if (fps < targetFps * this.opts.lowRatio) {
      this.goodSince = null;
      this.lowSince ??= now;
      if (now - this.lowSince >= this.opts.downAfterMs && this.levelIndex < RENDER_SCALES.length - 1) {
        this.blockedUntil.set(this.levelIndex, now + this.opts.blockMs);
        this.levelIndex++;
        this.lowSince = null;
        return true;
      }
    } else {
      this.lowSince = null;
      this.goodSince ??= now;
      const up = this.levelIndex - 1;
      if (up >= 0 && now - this.goodSince >= this.opts.upAfterMs && (this.blockedUntil.get(up) ?? 0) <= now) {
        this.levelIndex = up;
        this.goodSince = null;
        return true;
      }
    }
    return false;
  }
}
