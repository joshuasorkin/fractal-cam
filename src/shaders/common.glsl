// Shared prelude for every effect shader.
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCam;       // live camera frame
uniform sampler2D uPrev;      // previous output frame (feedback)
uniform sampler2D uMotionTex; // 64x36 decaying frame-difference map (camera space)
uniform vec4 uCamUV;          // output uv -> camera uv: xy scale, zw offset (cover crop + mirror)
uniform vec2 uRes;            // render target size in pixels
uniform float uTime;          // procedural time (already scaled by speed, paused by Space)

uniform float uIntensity;
uniform float uComplexity;
uniform float uDistortion;
uniform float uSaturation;
uniform float uCamMix;
uniform float uFeedback;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;

uniform float uMotion;        // 0..1 global motion energy
uniform vec2 uMotionPos;      // motion centroid, output uv
uniform vec4 uFace;           // x mouth open, y brow raise, z smile, w face present
uniform vec3 uHead;           // yaw, pitch, roll (radians, already mirror-corrected)
uniform vec3 uFacePos;        // xy face center (output uv), z face height
uniform vec4 uPulse;          // xy eye position (output uv), z blink pulse 0..1, w gaze x
uniform vec4 uHands;          // left wrist xy, right wrist xy (output uv)
uniform vec2 uPose;           // x arm raise, y pose present

#define PI 3.14159265
#define TAU 6.28318531

float aspect() { return uRes.x / uRes.y; }

vec2 camCoord(vec2 uv) {
  return uv * uCamUV.xy + uCamUV.zw;
}

// Sample the camera at an output-space coordinate. Out-of-range coordinates
// mirror-repeat so heavy warps never hit a hard edge.
vec3 cam(vec2 uv) {
  vec2 c = camCoord(uv);
  c = 1.0 - abs(1.0 - mod(c, 2.0));
  return texture(uCam, c).rgb;
}

float motionAt(vec2 uv) {
  return texture(uMotionTex, clamp(camCoord(uv), 0.0, 1.0)).r;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c);
}

// Raised eyebrows push the palette phase: same palette, new mood.
vec3 palette(float t) {
  return uPalA + uPalB * cos(TAU * (uPalC * t + uPalD + uFace.y * 0.35));
}

vec3 saturateColor(vec3 c, float s) {
  return max(mix(vec3(luma(c)), c, s), 0.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = rot(0.5) * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

// Fold angle into N mirrored wedges (radial symmetry).
vec2 kaleid(vec2 p, float n) {
  float a = atan(p.y, p.x);
  float s = TAU / n;
  a = mod(a + 0.5 * s, s) - 0.5 * s;
  a = abs(a);
  return vec2(cos(a), sin(a)) * length(p);
}

// Expanding ring launched from the eyes on each blink.
vec3 blinkPulse(vec2 uv, vec3 tint) {
  float p = uPulse.z;
  if (p < 0.01) return vec3(0.0);
  float d = length((uv - uPulse.xy) * vec2(aspect(), 1.0));
  float r = (1.0 - p) * 0.9;
  float ring = exp(-pow((d - r) * 18.0, 2.0)) * p;
  return tint * ring * 2.5;
}

vec3 finish(vec3 col) {
  col = saturateColor(col, uSaturation);
  col *= 1.0 + uFace.y * 0.45; // eyebrows: brightness kick
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * 0.6; // gentle vignette
  return col;
}
