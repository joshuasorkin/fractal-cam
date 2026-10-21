import { describe, expect, it } from 'vitest';
import { computeCamUV, videoToOutput } from '../../src/engine/cameraMapping';
import { isOutputRoute } from '../../src/route';

const toCam = (m: ReturnType<typeof computeCamUV>, u: number, v: number) => [u * m.scaleX + m.offsetX, v * m.scaleY + m.offsetY];

describe('camera mapping', () => {
  it('16:9 camera into 16:9 output is identity (unmirrored)', () => {
    const m = computeCamUV(1280, 720, 1280, 720, false);
    expect(toCam(m, 0, 0)).toEqual([0, 0]);
    expect(toCam(m, 1, 1)).toEqual([1, 1]);
  });

  it('mirroring flips x', () => {
    const m = computeCamUV(1280, 720, 1280, 720, true);
    expect(toCam(m, 0, 0)[0]).toBeCloseTo(1);
    expect(toCam(m, 1, 0)[0]).toBeCloseTo(0);
  });

  it('4:3 camera is cover-cropped top/bottom', () => {
    const m = computeCamUV(640, 480, 1280, 720, false);
    const [, y0] = toCam(m, 0, 0);
    const [, y1] = toCam(m, 0, 1);
    expect(y0).toBeGreaterThan(0);
    expect(y1).toBeLessThan(1);
    expect(y1 - y0).toBeCloseTo((4 / 3) / (16 / 9));
  });

  it('ultrawide camera is cropped left/right', () => {
    const m = computeCamUV(2560, 1080, 1280, 720, false);
    expect(toCam(m, 0, 0)[0]).toBeGreaterThan(0);
    expect(toCam(m, 0, 1)[1]).toBeCloseTo(1);
  });

  it('videoToOutput inverts the mapping (y down -> y up)', () => {
    for (const mirror of [false, true]) {
      const m = computeCamUV(640, 480, 1280, 720, mirror);
      const [u, v] = videoToOutput(m, 0.3, 0.25);
      const [cx, cy] = toCam(m, u, v);
      expect(cx).toBeCloseTo(0.3);
      expect(cy).toBeCloseTo(0.75);
    }
    // A face on the subject's right side of the raw frame appears on the left when mirrored.
    const [u] = videoToOutput(computeCamUV(1280, 720, 1280, 720, true), 0.8, 0.5);
    expect(u).toBeCloseTo(0.2);
  });

  it('handles a video without dimensions yet', () => {
    const m = computeCamUV(0, 0, 1280, 720, false);
    expect(m.scaleX).toBe(1);
  });
});

describe('routing', () => {
  it('detects the output route', () => {
    expect(isOutputRoute({ pathname: '/output', search: '' })).toBe(true);
    expect(isOutputRoute({ pathname: '/output/', search: '' })).toBe(true);
    expect(isOutputRoute({ pathname: '/', search: '?output' })).toBe(true);
    expect(isOutputRoute({ pathname: '/', search: '' })).toBe(false);
    expect(isOutputRoute({ pathname: '/outputs', search: '' })).toBe(false);
  });
});
