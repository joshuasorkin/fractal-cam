// Effect id -> fragment shader. Each shader is prefixed with the shared prelude.
import common from '../shaders/common.glsl?raw';
import fractalWarp from '../shaders/fractalWarp.frag?raw';
import kaleido from '../shaders/kaleido.frag?raw';
import fractalEntity from '../shaders/fractalEntity.frag?raw';
import glitch from '../shaders/glitch.frag?raw';
import type { EffectId } from '../params/params';

export const EFFECT_SHADERS: Record<EffectId, string> = {
  warp: `${common}\n${fractalWarp}`,
  kaleido: `${common}\n${kaleido}`,
  entity: `${common}\n${fractalEntity}`,
  glitch: `${common}\n${glitch}`,
};
