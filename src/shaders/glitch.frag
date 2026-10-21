// Effect D: Glitch Dimension — scanline tears, block fragmentation, chromatic
// aberration, edge neon and datamosh smearing where you are not moving.

void main() {
  float asp = aspect();
  float t = uTime;
  float mouth = uFace.x;
  float energy = uIntensity * (0.6 + 1.5 * uMotion + 1.3 * mouth + 0.6 * uPose.x);
  float tq = floor(t * 10.0);
  float tq2 = floor(t * 3.0);

  vec2 uv = vUv;

  // Geometric fragmentation: rectangles that jump to the wrong place.
  float blocks = mix(4.0, 44.0, uComplexity / 24.0);
  vec2 bid = floor(uv * vec2(blocks * asp / 1.6, blocks));
  float rb = hash12(bid + tq2 * 13.1);
  float glitchAmt = clamp((0.15 + 0.5 * energy) * uDistortion, 0.0, 1.5);
  if (rb < glitchAmt * 0.3) uv += (hash22(bid + tq) - 0.5) * 0.18 * energy;

  // Scanline jitter and big horizontal tears.
  float row = floor(uv.y * uRes.y / 3.0);
  float bandId = floor(uv.y * 18.0);
  float tear = step(1.0 - 0.14 * energy, hash12(vec2(bandId, tq)));
  uv.x += (hash12(vec2(row, tq)) - 0.5) * 0.012 * energy * uDistortion;
  uv.x += tear * (hash12(vec2(bandId, tq + 1.0)) - 0.5) * 0.3 * energy;
  // Head yaw slides the signal sideways.
  uv.x += uHead.x * 0.12 * sin(uv.y * 30.0 + t * 4.0);

  // Chromatic aberration radiating from the face.
  vec2 dir = uv - mix(vec2(0.5), uFacePos.xy, uFace.w);
  float ca = (0.004 + 0.022 * energy) * uDistortion;
  vec3 col;
  col.r = cam(uv + dir * ca * 3.0 + vec2(ca, 0.0)).r;
  col.g = cam(uv).g;
  col.b = cam(uv - dir * ca * 3.0 - vec2(ca, 0.0)).b;

  // Sobel edges -> neon wireframe.
  vec2 px = 1.5 / uRes;
  float tl = luma(cam(uv + px * vec2(-1, 1)));
  float tc = luma(cam(uv + px * vec2(0, 1)));
  float tr = luma(cam(uv + px * vec2(1, 1)));
  float ml = luma(cam(uv + px * vec2(-1, 0)));
  float mr = luma(cam(uv + px * vec2(1, 0)));
  float bl = luma(cam(uv + px * vec2(-1, -1)));
  float bc = luma(cam(uv + px * vec2(0, -1)));
  float br = luma(cam(uv + px * vec2(1, -1)));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  float edge = length(vec2(gx, gy));
  vec3 pal = palette(edge * 2.0 + uv.y * 0.6 + t * 0.2);

  // Posterize toward the palette.
  float levels = mix(10.0, 3.0, clamp(uIntensity * 0.5, 0.0, 1.0));
  vec3 poster = floor(col * levels + 0.5) / levels;
  col = mix(poster * mix(pal * 1.6, vec3(1.0), uCamMix), col, 0.15);
  col += pal * smoothstep(0.1, 0.6, edge) * 1.8 * uIntensity;

  // Channel swaps and inverted fragments.
  if (rb > 1.0 - glitchAmt * 0.15) col = col.brg;
  if (hash12(bid * 1.7 + tq) > 0.988 - 0.01 * energy) col = 1.0 - col;

  // Static, scanlines.
  col += (hash12(vUv * uRes + fract(t) * 917.0) - 0.5) * 0.2 * energy;
  col *= 0.82 + 0.18 * sin(vUv.y * uRes.y * PI * 0.5);

  // Datamosh: still regions keep smeared old pixels, moving regions refresh.
  float m = motionAt(vUv);
  vec2 smear = vec2(0.0, -0.003) + (hash22(bid) - 0.5) * 0.008;
  vec3 prev = texture(uPrev, vUv + smear).rgb;
  float refresh = clamp(m * 3.0 + (1.0 - uFeedback) + step(0.92, hash12(bid + tq)), 0.0, 1.0);
  col = mix(prev, col, refresh);

  // Blink: a bright scan sweep at eye height.
  col += pal * uPulse.z * exp(-abs(vUv.y - uPulse.y) * 40.0) * 2.0;

  fragColor = vec4(finish(col), 1.0);
}
