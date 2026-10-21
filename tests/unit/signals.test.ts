import { describe, expect, it } from 'vitest';
import { eulerFromMatrix, faceTargets, neutralSignals, poseTargets, SignalSmoother, smoothToward, type FaceFrame } from '../../src/tracking/signals';

/** Column-major 4x4 from a row-major 3x3 rotation, with a uniform scale and translation. */
function mat4(r: number[][], scale = 1): number[] {
  const m = new Array(16).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row][col] * scale;
  m[12] = 3;
  m[13] = -2;
  m[14] = -40;
  m[15] = 1;
  return m;
}
const c = Math.cos, s = Math.sin;
const Rx = (a: number) => [[1, 0, 0], [0, c(a), -s(a)], [0, s(a), c(a)]];
const Ry = (a: number) => [[c(a), 0, s(a)], [0, 1, 0], [-s(a), 0, c(a)]];
const Rz = (a: number) => [[c(a), -s(a), 0], [s(a), c(a), 0], [0, 0, 1]];

function face(blend: Record<string, number> = {}, matrix: number[] | null = null): FaceFrame {
  return { blend, matrix, nose: [0.4, 0.5], eyes: [0.4, 0.42], bbox: [0.3, 0.3, 0.5, 0.7] };
}

describe('head pose from transformation matrix', () => {
  it('recovers yaw, pitch and roll independently (and ignores scale)', () => {
    expect(eulerFromMatrix(mat4(Ry(0.4), 1.7)).yaw).toBeCloseTo(0.4);
    expect(eulerFromMatrix(mat4(Rx(-0.3))).pitch).toBeCloseTo(-0.3);
    expect(eulerFromMatrix(mat4(Rz(0.5), 0.5)).roll).toBeCloseTo(0.5);
    const r = eulerFromMatrix(mat4(Rz(0.5)));
    expect(r.yaw).toBeCloseTo(0);
    expect(r.pitch).toBeCloseTo(0);
  });
});

describe('face targets', () => {
  it('normalizes blendshapes into 0..1', () => {
    const closed = faceTargets(face({ jawOpen: 0.01 }));
    const open = faceTargets(face({ jawOpen: 0.9, browInnerUp: 0.9, eyeBlinkLeft: 1, eyeBlinkRight: 1 }));
    expect(closed.mouth).toBe(0);
    expect(open.mouth).toBe(1);
    expect(open.brow).toBe(1);
    expect(open.blink).toBe(1);
  });

  it('works without a matrix', () => {
    const t = faceTargets(face({}, null));
    expect(t.yaw).toBe(0);
    expect(t.faceSize).toBeCloseTo(0.4);
  });
});

describe('pose targets', () => {
  it('arm raise grows as wrists rise above shoulders', () => {
    const base = { leftShoulder: [0.4, 0.6, 1], rightShoulder: [0.6, 0.6, 1] } as const;
    const down = poseTargets({ ...base, leftWrist: [0.4, 0.9, 1], rightWrist: [0.6, 0.9, 1] } as never);
    const up = poseTargets({ ...base, leftWrist: [0.4, 0.2, 1], rightWrist: [0.6, 0.9, 1] } as never);
    expect(down.armRaise).toBe(0);
    expect(up.armRaise).toBe(1);
  });
});

describe('smoothing', () => {
  it('is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = smoothToward(a, 1, 1 / 60, 0.2);
    let b = 0;
    for (let i = 0; i < 30; i++) b = smoothToward(b, 1, 1 / 30, 0.2);
    expect(a).toBeCloseTo(b, 6);
  });

  it('follows the face, then relaxes to neutral when tracking is lost', () => {
    const sm = new SignalSmoother();
    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += 1 / 30;
      sm.pushFace(face({ jawOpen: 0.9 }), now);
      sm.tick(now, 1 / 30);
    }
    expect(sm.signals.facePresent).toBeGreaterThan(0.9);
    expect(sm.signals.mouth).toBeGreaterThan(0.9);
    for (let i = 0; i < 150; i++) {
      now += 1 / 30;
      sm.tick(now, 1 / 30);
    }
    expect(sm.signals.facePresent).toBeLessThan(0.05);
    expect(sm.signals.mouth).toBeLessThan(0.05);
    expect(sm.signals.faceX).toBeCloseTo(neutralSignals().faceX, 1);
  });

  it('fires one decaying pulse per blink', () => {
    const sm = new SignalSmoother();
    let now = 0;
    const step = (blink: number) => {
      now += 1 / 30;
      sm.pushFace(face({ eyeBlinkLeft: blink, eyeBlinkRight: blink }), now);
      sm.tick(now, 1 / 30);
    };
    step(0);
    step(0.9);
    const first = sm.signals.pulse;
    expect(first).toBeGreaterThan(0.8);
    step(0.9); // still closed: no re-trigger
    expect(sm.signals.pulse).toBeLessThan(first);
    for (let i = 0; i < 30; i++) step(0);
    expect(sm.signals.pulse).toBeLessThan(0.15);
    step(0.9);
    expect(sm.signals.pulse).toBeGreaterThan(0.8);
  });
});
