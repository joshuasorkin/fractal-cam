// Effect C: Fractal Entity — a Julia set whose domain and parameter are bent by
// the camera image itself, with your picture texture-mapped through the orbit trap.

void main() {
  float asp = aspect();
  float t = uTime;
  float mouth = uFace.x;
  float present = uFace.w;

  vec3 here = cam(vUv);
  float L = luma(here);
  float m = motionAt(vUv);

  vec2 center = mix(vec2(0.5), uFacePos.xy, 0.4 * present);
  vec2 z = (vUv - center) * vec2(asp, 1.0) * (2.3 - 0.5 * uIntensity);
  z = rot(uHead.z + t * 0.03) * z;

  // The figure deforms fractal space: bright areas push outward, dark pull in.
  float d = uDistortion * uIntensity;
  z += normalize(z + 1e-4) * (L - 0.5) * 0.5 * d;

  // Julia parameter orbits the Mandelbrot boundary; head yaw/pitch steer it,
  // hands drag it, an open mouth makes it boil.
  float ang = t * 0.11 + uHead.x * 1.4;
  vec2 c = 0.7885 * vec2(cos(ang), sin(ang));
  c += vec2(uHead.y * 0.15, 0.0);
  c += (uHands.xy + uHands.zw - 1.0) * 0.12 * uPose.y;
  c += vec2(sin(t * 3.1), cos(t * 2.7)) * 0.04 * mouth * uIntensity;
  // Per-pixel: the image and its motion perturb c, so the person is drawn in
  // the fractal's own structure rather than pasted over it.
  c += (L - 0.5) * 0.16 * d + m * 0.1;

  int maxIt = int(clamp(uComplexity * 3.0 + 10.0, 16.0, 80.0));
  vec2 trapP = vec2(0.35 * sin(t * 0.4), 0.2 * cos(t * 0.3));
  float trap = 1e9;
  vec2 zt = z;
  float it = 0.0;
  bool escaped = false;
  for (int i = 0; i < 80; i++) {
    if (i >= maxIt) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float tr = length(z - trapP);
    if (tr < trap) { trap = tr; zt = z; }
    if (dot(z, z) > 256.0) { escaped = true; break; }
    it += 1.0;
  }

  float mu = escaped ? it - log2(log2(dot(z, z))) + 4.0 : float(maxIt);
  float fi = clamp(mu / float(maxIt), 0.0, 1.0);

  // Your image lives inside the orbit trap: repeated faces in the spirals.
  vec3 trapCam = cam(center + zt * 0.28 / vec2(asp, 1.0));
  vec3 pal = palette(mu * 0.05 + trap * 0.4 - t * 0.08);
  float glow = exp(-trap * 3.5);
  // Escape-time contour bands pulse outward from the set.
  float bands = 0.5 + 0.5 * cos(mu * 1.1 - t * 2.5);
  vec3 outside = pal * (0.12 + 1.3 * pow(fi, 0.45)) * (0.55 + 0.7 * bands) + trapCam * pal * glow * 1.6;
  vec3 inside = trapCam * (0.4 + 0.9 * palette(trap - t * 0.1));
  vec3 frac = escaped ? outside : inside;

  // Luminous outline of the real figure (luma gradient), tinted by the fractal.
  vec2 px = 2.0 / uRes;
  float gx = luma(cam(vUv + vec2(px.x, 0.0))) - luma(cam(vUv - vec2(px.x, 0.0)));
  float gy = luma(cam(vUv + vec2(0.0, px.y))) - luma(cam(vUv - vec2(0.0, px.y)));
  float edge = smoothstep(0.03, 0.25, length(vec2(gx, gy)));

  vec3 col = mix(frac, frac * 0.45 + here * pal * 1.7, uCamMix * 0.8);
  col += pal.gbr * edge * 0.9 * uIntensity;
  col += pal * m * uIntensity;

  vec3 prev = texture(uPrev, (vUv - 0.5) * 0.99 + 0.5).rgb;
  col = max(col, prev * uFeedback * 0.95);
  col += blinkPulse(vUv, pal.bgr);

  fragColor = vec4(finish(col), 1.0);
}
