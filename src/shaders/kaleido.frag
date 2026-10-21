// Effect B: Kaleidoscopic Being — the whole frame (you and the room) folded into
// a rotating mandala centered on your face.

void main() {
  float asp = aspect();
  float t = uTime;
  float mouth = uFace.x;
  float present = uFace.w;

  vec2 center = mix(vec2(0.5), uFacePos.xy, 0.35 * present);
  vec2 p = (vUv - center) * vec2(asp, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);

  // Body motion and speech send ripples through the mandala.
  r += sin(r * 28.0 - t * 6.0) * 0.015 * (uMotion * 3.0 + mouth * 2.0 + 0.2) * uIntensity;
  // Head roll turns the wheel; yaw adds spin.
  a += t * 0.15 + uHead.z * 2.0 + uHead.x * 1.2;
  // Spiral twist.
  a += r * uDistortion * 2.5 * sin(t * 0.3);

  float seg = max(2.0, floor(uComplexity + 0.5));
  float s = TAU / seg;
  float am = abs(mod(a, s) - 0.5 * s);

  // Zoomed in so the person fills the mandala; the sampled wedge sweeps
  // around the source image so new parts of you and the room keep entering.
  float zoom = 0.55 + 0.18 * sin(t * 0.5) - 0.3 * mouth * uIntensity + 0.2 * uPose.x;
  float rr = r * zoom;
  float sweep = t * 0.23 + uHead.x * 1.5;
  vec2 src = mix(vec2(0.5), uFacePos.xy, present) + 0.06 * vec2(sin(t * 0.31), cos(t * 0.27));
  vec2 suv = src + vec2(cos(am + sweep), sin(am + sweep)) * rr / vec2(asp, 1.0);
  vec3 c1 = cam(suv);

  // Second, counter-rotating layer with doubled symmetry.
  float a2 = atan(p.y, p.x) - t * 0.22 - uHead.z;
  float s2 = s * 0.5;
  float am2 = abs(mod(a2, s2) - 0.5 * s2);
  vec2 suv2 = src + vec2(cos(am2 - sweep), sin(am2 - sweep)) * (r * 1.1 + 0.08 * sin(t)) / vec2(asp, 1.0);
  vec3 c2 = cam(suv2);
  vec3 c = mix(c1, 1.0 - (1.0 - c1) * (1.0 - c2), clamp(0.45 * uIntensity, 0.0, 1.0));

  float l = luma(c);
  vec3 pal = palette(l + r * 0.8 - t * 0.1);
  vec3 col = mix(pal * (0.25 + 1.4 * l), c * (0.7 + 0.6 * pal), uCamMix);

  // Glowing seams along the mirror lines.
  float seam = exp(-am * rr * 90.0) * smoothstep(0.0, 0.05, r);
  col += pal.zxy * seam * 0.7 * uIntensity;
  // Motion-gated concentric rings.
  col += palette(r * 3.0 - t) * smoothstep(0.96, 1.0, sin(r * 40.0 - t * 5.0)) * (0.05 + uMotion * 1.8 + mouth) * uIntensity;
  // Moving parts of the image flare inside the pattern.
  col += pal * motionAt(suv) * 1.2 * uIntensity;

  vec2 fb = rot(-0.01) * (vUv - center) * 0.985 + center;
  col = mix(col, max(col, texture(uPrev, fb).rgb), uFeedback * 0.9);
  col += blinkPulse(vUv, pal.bgr);

  fragColor = vec4(finish(col), 1.0);
}
