// Effect A: Fractal Warp — the camera image is folded through an iterated
// inversion map, radially mirrored and fed back into a zooming tunnel.

void main() {
  float asp = aspect();
  float t = uTime;
  float mouth = uFace.x;
  float present = uFace.w;
  float energy = uIntensity * (1.0 + 1.6 * mouth + 1.3 * uMotion + 0.8 * uPose.x);

  vec2 center = mix(vec2(0.5), uFacePos.xy, 0.5 * present);
  vec2 p = (vUv - center) * vec2(asp, 1.0);

  // Head roll/yaw spins and drags the whole space.
  p = rot(uHead.z * 1.6 + uHead.x * 0.7 + sin(t * 0.13) * 0.4) * p;
  p += vec2(uHead.x, -uHead.y) * 0.2;

  // Raised hands become vortices.
  for (int h = 0; h < 2; h++) {
    vec2 hp = ((h == 0 ? uHands.xy : uHands.zw) - center) * vec2(asp, 1.0);
    vec2 d = p - hp;
    p = hp + rot(uPose.y * (1.0 + 2.0 * uPose.x) * 2.5 * exp(-dot(d, d) * 14.0)) * d;
  }

  float seg = floor(uComplexity + 0.5);
  if (seg > 1.5) p = kaleid(p, seg);

  // Flowing domain warp.
  vec2 w = vec2(fbm(p * 2.2 + vec2(t * 0.25, -t * 0.2)),
                fbm(p * 2.2 + vec2(5.2, 1.3) - t * 0.21)) - 0.5;

  // Iterated inversion fold (Kali-style fractal) — mouth opening shifts the fold
  // constant, which tears the structure open.
  vec2 q = p * (1.2 + 0.25 * sin(t * 0.2));
  vec2 k = vec2(0.82 + 0.12 * sin(t * 0.17), 0.66 + 0.15 * cos(t * 0.11)) + vec2(mouth * 0.3, uFace.y * 0.1);
  float trap = 10.0;
  for (int i = 0; i < 6; i++) {
    q = abs(q) / clamp(dot(q, q), 0.12, 4.0) - k;
    q = rot(0.3 + t * 0.05) * q;
    trap = min(trap, abs(length(q) - 0.5));
  }

  float d = uDistortion * energy;
  vec2 wp = p + w * 0.7 * d + q * 0.07 * d;
  vec3 c = cam(center + wp / vec2(asp, 1.0));
  float l = luma(c);

  vec3 pal = palette(l * 1.4 + trap * 0.6 + length(p) * 0.5 - t * 0.12);
  vec3 neon = pal * (0.3 + 1.5 * l) + palette(trap + t * 0.2) * exp(-trap * 7.0) * 0.9 * uIntensity;
  vec3 col = mix(neon, c * (0.5 + 0.9 * pal), uCamMix);

  // Feedback: previous frame pulled into a rotating tunnel around the face.
  vec2 fb = rot(0.015 + uHead.z * 0.04) * (vUv - center) * (0.972 - 0.03 * mouth) + center;
  vec3 prev = texture(uPrev, fb).rgb;
  col = max(col, prev * uFeedback * 0.985);

  // Movement leaves bright scars.
  col += pal.gbr * motionAt(vUv) * 1.4 * uIntensity;
  col += blinkPulse(vUv, palette(t + 0.33));

  fragColor = vec4(finish(col), 1.0);
}
