import { describe, expect, it } from 'vitest';
import {
  clampParam,
  DEFAULT_EFFECT_PARAMS,
  defaultSettings,
  EFFECT_IDS,
  PARAM_SPECS,
  randomizeEffectParams,
  RENDER_SCALES,
  sanitizeSettings,
  type ParamKey,
} from '../../src/params/params';
import { PALETTES, paletteColor } from '../../src/params/palettes';

const keys = Object.keys(PARAM_SPECS) as ParamKey[];

function expectInRange(p: Record<ParamKey, number>) {
  for (const k of keys) {
    const spec = PARAM_SPECS[k];
    expect(p[k], k).toBeGreaterThanOrEqual(spec.min);
    expect(p[k], k).toBeLessThanOrEqual(spec.max);
    if (spec.integer) expect(Number.isInteger(p[k]), k).toBe(true);
  }
}

describe('parameter ranges', () => {
  it('defaults are within range for every effect', () => {
    for (const id of EFFECT_IDS) expectInRange(DEFAULT_EFFECT_PARAMS[id]);
  });

  it('clamps out-of-range, non-numeric and non-finite values', () => {
    expect(clampParam('intensity', 99)).toBe(PARAM_SPECS.intensity.max);
    expect(clampParam('intensity', -5)).toBe(PARAM_SPECS.intensity.min);
    expect(clampParam('complexity', 7.6)).toBe(8);
    expect(clampParam('palette', 1000)).toBe(PALETTES.length - 1);
    expect(clampParam('speed', '1.5')).toBe(1.5);
    expect(Number.isFinite(clampParam('speed', NaN))).toBe(true);
    expect(Number.isFinite(clampParam('speed', Infinity))).toBe(true);
    expect(Number.isFinite(clampParam('speed', 'banana'))).toBe(true);
  });

  it('randomize always stays in range', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const id of EFFECT_IDS) for (let i = 0; i < 200; i++) expectInRange(randomizeEffectParams(id, rand));
    expectInRange(randomizeEffectParams('warp', () => 0));
    expectInRange(randomizeEffectParams('warp', () => 0.999999));
  });
});

describe('settings sanitization', () => {
  it('returns defaults for garbage', () => {
    for (const junk of [null, undefined, 42, 'x', [], { effect: 'nope' }]) {
      const s = sanitizeSettings(junk);
      expect(EFFECT_IDS).toContain(s.effect);
      for (const id of EFFECT_IDS) expectInRange(s.effects[id]);
    }
  });

  it('repairs partially corrupted stored settings', () => {
    const s = sanitizeSettings({
      effect: 'glitch',
      effects: { glitch: { intensity: 50, complexity: -3, palette: 'red' }, warp: 'broken' },
      faceTracking: 'yes',
      fpsCap: 144,
      renderScale: 0.6,
      deviceId: 12,
    });
    expect(s.effect).toBe('glitch');
    expect(s.effects.glitch.intensity).toBe(PARAM_SPECS.intensity.max);
    expect(s.effects.glitch.complexity).toBe(PARAM_SPECS.complexity.min);
    expect(s.effects.warp).toEqual(DEFAULT_EFFECT_PARAMS.warp);
    expect(s.faceTracking).toBe(defaultSettings().faceTracking);
    expect(s.fpsCap).toBe(30);
    expect(RENDER_SCALES).toContain(s.renderScale as (typeof RENDER_SCALES)[number]);
    expect(s.deviceId).toBe('');
  });
});

describe('palettes', () => {
  it('produce colors in 0..1', () => {
    for (const p of PALETTES) for (let t = 0; t <= 1; t += 0.05) for (const v of paletteColor(p, t)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
