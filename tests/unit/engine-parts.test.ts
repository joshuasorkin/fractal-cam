import { describe, expect, it } from 'vitest';
import { computeMotion } from '../../src/motion/MotionEstimator';
import { AdaptiveQuality, FpsCounter } from '../../src/engine/PerfMonitor';
import { describeCameraError, isVirtualCameraLabel } from '../../src/capture/camera';
import { RENDER_SCALES } from '../../src/params/params';

describe('motion estimation', () => {
  const W = 8, H = 4;
  it('reports zero for identical frames', () => {
    const a = new Float32Array(W * H).fill(0.5);
    const map = new Uint8Array(W * H);
    const r = computeMotion(a, a, map, W, H);
    expect(r.raw).toBe(0);
    expect(Math.max(...map)).toBe(0);
  });

  it('localizes motion and writes the map bottom-up (GL orientation)', () => {
    const prev = new Float32Array(W * H);
    const cur = new Float32Array(W * H);
    cur[0 * W + 7] = 1; // top-right pixel changed
    const map = new Uint8Array(W * H);
    const r = computeMotion(prev, cur, map, W, H);
    expect(r.raw).toBeGreaterThan(0);
    expect(r.cx).toBeGreaterThan(0.8);
    expect(r.cy).toBeLessThan(0.2);
    expect(map[(H - 1) * W + 7]).toBeGreaterThan(0); // top row is last in GL order
    expect(map[7]).toBe(0);
  });

  it('decays the map when motion stops', () => {
    const a = new Float32Array(W * H);
    const b = new Float32Array(W * H).fill(1);
    const map = new Uint8Array(W * H);
    computeMotion(a, b, map, W, H);
    const before = map[0];
    computeMotion(b, b, map, W, H);
    expect(map[0]).toBeLessThan(before);
    expect(map[0]).toBeGreaterThan(0);
  });
});

describe('performance monitor', () => {
  it('measures fps', () => {
    const f = new FpsCounter();
    for (let i = 1; i <= 31; i++) f.frame(i * (1000 / 30));
    expect(f.fps).toBeGreaterThan(28);
    expect(f.fps).toBeLessThan(32);
  });

  it('steps down when slow, back up after sustained headroom, and avoids oscillation', () => {
    const q = new AdaptiveQuality(1);
    let now = 0;
    const run = (fps: number, ms: number) => {
      let changed = false;
      for (const end = now + ms; now < end; now += 500) changed = q.update(fps, 30, now) || changed;
      return changed;
    };
    expect(run(30, 5000)).toBe(false);
    expect(q.scale).toBe(1);
    expect(run(18, 2600)).toBe(true);
    expect(q.scale).toBe(RENDER_SCALES[1]);
    // Healthy again: the level that was too slow stays blocked for a while.
    run(30, 9000);
    expect(q.scale).toBe(RENDER_SCALES[1]);
    run(30, 30000);
    expect(q.scale).toBe(1);
  });

  it('never leaves the scale table', () => {
    const q = new AdaptiveQuality(0.45);
    for (let t = 0; t < 60000; t += 500) q.update(5, 30, t);
    expect(q.scale).toBe(RENDER_SCALES[RENDER_SCALES.length - 1]);
  });
});

describe('camera errors', () => {
  it('maps DOMException names to actionable messages', () => {
    expect(describeCameraError({ name: 'NotAllowedError', message: '' }).code).toBe('denied');
    expect(describeCameraError({ name: 'NotFoundError', message: '' }).code).toBe('notfound');
    expect(describeCameraError({ name: 'NotReadableError', message: '' }).code).toBe('busy');
    expect(describeCameraError({ name: 'SecurityError', message: '' }).code).toBe('insecure');
    expect(describeCameraError(new Error('weird')).code).toBe('unknown');
    expect(describeCameraError({ name: 'NotAllowedError', message: '' }).message).toMatch(/Allow/);
  });

  it('flags virtual cameras to avoid feedback loops', () => {
    expect(isVirtualCameraLabel('OBS Virtual Camera')).toBe(true);
    expect(isVirtualCameraLabel('OBS-Camera')).toBe(true);
    expect(isVirtualCameraLabel('Integrated Webcam (0c45:6a10)')).toBe(false);
    expect(isVirtualCameraLabel('HD User Facing')).toBe(false);
  });
});
