// Effect parameters, settings schema, defaults, range clamping and randomization.
// Everything here is pure so it can be unit-tested without a browser.

import { PALETTES } from './palettes';

export const EFFECT_IDS = ['warp', 'kaleido', 'entity', 'glitch'] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export const EFFECT_INFO: Record<EffectId, { name: string; key: string; blurb: string; complexityLabel: string }> = {
  warp: { name: 'Fractal Warp', key: '1', blurb: 'Folded space, feedback tunnels', complexityLabel: 'Symmetry' },
  kaleido: { name: 'Kaleidoscopic Being', key: '2', blurb: 'You, mirrored into a mandala', complexityLabel: 'Segments' },
  entity: { name: 'Fractal Entity', key: '3', blurb: 'A Julia set that wears your face', complexityLabel: 'Iterations' },
  glitch: { name: 'Glitch Dimension', key: '4', blurb: 'Reassembled from bad signals', complexityLabel: 'Fragmentation' },
};

export interface EffectParams {
  intensity: number; // overall strength of the transformation
  speed: number; // procedural animation speed multiplier
  complexity: number; // symmetry segments / iterations / fragmentation
  distortion: number; // amount of nonlinear coordinate warping
  saturation: number; // color saturation
  camMix: number; // how much of the original camera color survives
  feedback: number; // trail / persistence from the previous frame
  palette: number; // index into PALETTES
}

export type ParamKey = keyof EffectParams;

export interface ParamSpec {
  min: number;
  max: number;
  step: number;
  label: string;
  integer?: boolean;
}

export const PARAM_SPECS: Record<ParamKey, ParamSpec> = {
  intensity: { min: 0, max: 2, step: 0.01, label: 'Intensity' },
  speed: { min: 0, max: 3, step: 0.01, label: 'Animation speed' },
  complexity: { min: 1, max: 24, step: 1, label: 'Complexity', integer: true },
  distortion: { min: 0, max: 2, step: 0.01, label: 'Distortion' },
  saturation: { min: 0, max: 2, step: 0.01, label: 'Saturation' },
  camMix: { min: 0, max: 1, step: 0.01, label: 'Camera contribution' },
  feedback: { min: 0, max: 0.97, step: 0.01, label: 'Feedback trails' },
  palette: { min: 0, max: PALETTES.length - 1, step: 1, label: 'Palette', integer: true },
};

export const DEFAULT_EFFECT_PARAMS: Record<EffectId, EffectParams> = {
  warp: { intensity: 1.0, speed: 1.0, complexity: 6, distortion: 0.9, saturation: 1.3, camMix: 0.35, feedback: 0.6, palette: 0 },
  kaleido: { intensity: 1.0, speed: 1.0, complexity: 8, distortion: 0.6, saturation: 1.25, camMix: 0.65, feedback: 0.35, palette: 2 },
  entity: { intensity: 1.0, speed: 1.0, complexity: 14, distortion: 1.0, saturation: 1.3, camMix: 0.5, feedback: 0.25, palette: 1 },
  glitch: { intensity: 1.0, speed: 1.0, complexity: 10, distortion: 1.0, saturation: 1.2, camMix: 0.7, feedback: 0.55, palette: 4 },
};

/** Value of DeviceSelection meaning "use the built-in animated test pattern instead of a camera". */
export const SYNTHETIC_DEVICE = 'synthetic';

export interface Settings {
  effect: EffectId;
  effects: Record<EffectId, EffectParams>;
  faceTracking: boolean;
  poseTracking: boolean;
  motionResponsive: boolean;
  mirror: boolean;
  adaptiveQuality: boolean;
  /** Internal render scale relative to the 1280x720 output (used when adaptive quality is off). */
  renderScale: number;
  fpsCap: 30 | 60;
  /** Camera deviceId, SYNTHETIC_DEVICE, or '' for "default camera". */
  deviceId: string;
  /** Procedural animation paused (Space). Synced between windows but not persisted. */
  paused: boolean;
}

export const RENDER_SCALES = [1, 0.85, 0.7, 0.55, 0.45] as const;

export function defaultSettings(): Settings {
  return {
    effect: 'warp',
    effects: structuredClone(DEFAULT_EFFECT_PARAMS),
    faceTracking: true,
    poseTracking: false,
    motionResponsive: true,
    mirror: true,
    adaptiveQuality: true,
    renderScale: 0.85,
    fpsCap: 30,
    deviceId: '',
    paused: false,
  };
}

export function clampParam(key: ParamKey, value: unknown): number {
  const spec = PARAM_SPECS[key];
  let v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v)) v = DEFAULT_EFFECT_PARAMS.warp[key];
  v = Math.min(spec.max, Math.max(spec.min, v));
  if (spec.integer) v = Math.round(v);
  return v;
}

export function sanitizeEffectParams(raw: unknown, effect: EffectId): EffectParams {
  const base = DEFAULT_EFFECT_PARAMS[effect];
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const key of Object.keys(PARAM_SPECS) as ParamKey[]) {
    out[key] = key in src ? clampParam(key, src[key]) : base[key];
  }
  return out;
}

function nearestScale(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0.85;
  return RENDER_SCALES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), RENDER_SCALES[0]);
}

/** Coerce arbitrary (possibly corrupted or outdated) stored JSON into valid Settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const effectsRaw = (r.effects && typeof r.effects === 'object' ? r.effects : {}) as Record<string, unknown>;
  const effects = {} as Record<EffectId, EffectParams>;
  for (const id of EFFECT_IDS) effects[id] = sanitizeEffectParams(effectsRaw[id], id);
  return {
    effect: EFFECT_IDS.includes(r.effect as EffectId) ? (r.effect as EffectId) : d.effect,
    effects,
    faceTracking: bool(r.faceTracking, d.faceTracking),
    poseTracking: bool(r.poseTracking, d.poseTracking),
    motionResponsive: bool(r.motionResponsive, d.motionResponsive),
    mirror: bool(r.mirror, d.mirror),
    adaptiveQuality: bool(r.adaptiveQuality, d.adaptiveQuality),
    renderScale: nearestScale(r.renderScale),
    fpsCap: r.fpsCap === 60 ? 60 : 30,
    deviceId: typeof r.deviceId === 'string' ? r.deviceId : d.deviceId,
    paused: bool(r.paused, false),
  };
}

/** Random but tasteful parameters: biased away from the dull corners of the space. */
export function randomizeEffectParams(effect: EffectId, rand: () => number = Math.random): EffectParams {
  const lerp = (a: number, b: number) => a + (b - a) * rand();
  const complexityRange: Record<EffectId, [number, number]> = {
    warp: [3, 12],
    kaleido: [4, 18],
    entity: [8, 22],
    glitch: [4, 20],
  };
  const [cMin, cMax] = complexityRange[effect];
  return sanitizeEffectParams(
    {
      intensity: lerp(0.8, 1.8),
      speed: lerp(0.5, 2.0),
      complexity: lerp(cMin, cMax),
      distortion: lerp(0.4, 1.8),
      saturation: lerp(0.9, 1.8),
      camMix: lerp(0.2, 0.8),
      feedback: lerp(0.2, 0.85),
      palette: Math.floor(rand() * PALETTES.length),
    },
    effect,
  );
}
