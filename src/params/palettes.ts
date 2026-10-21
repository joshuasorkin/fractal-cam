// Cosine gradient palettes (after Inigo Quilez): color(t) = a + b * cos(2π(c·t + d)).

export type Vec3 = [number, number, number];

export interface Palette {
  name: string;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
}

export const PALETTES: Palette[] = [
  { name: 'Hyperspace', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.0, 0.33, 0.67] },
  { name: 'Ultraviolet', a: [0.5, 0.2, 0.6], b: [0.5, 0.4, 0.5], c: [1.0, 1.0, 0.5], d: [0.8, 0.9, 0.3] },
  { name: 'Acid Lagoon', a: [0.4, 0.6, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.3, 0.2, 0.2] },
  { name: 'Solar Flare', a: [0.6, 0.35, 0.2], b: [0.5, 0.45, 0.3], c: [1.0, 0.7, 0.4], d: [0.0, 0.15, 0.2] },
  { name: 'Neon Static', a: [0.5, 0.5, 0.5], b: [0.6, 0.6, 0.6], c: [2.0, 1.0, 0.0], d: [0.5, 0.2, 0.25] },
  { name: 'Deep Ocean', a: [0.2, 0.4, 0.6], b: [0.3, 0.4, 0.4], c: [1.0, 1.0, 1.0], d: [0.6, 0.5, 0.4] },
  { name: 'Candy Void', a: [0.8, 0.5, 0.6], b: [0.4, 0.4, 0.4], c: [0.6, 1.0, 1.0], d: [0.0, 0.3, 0.6] },
  { name: 'Toxic', a: [0.4, 0.7, 0.2], b: [0.4, 0.4, 0.3], c: [1.0, 1.5, 1.0], d: [0.2, 0.0, 0.6] },
];

export function paletteColor(p: Palette, t: number): Vec3 {
  return [0, 1, 2].map((i) => {
    const v = p.a[i] + p.b[i] * Math.cos(2 * Math.PI * (p.c[i] * t + p.d[i]));
    return Math.min(1, Math.max(0, v));
  }) as Vec3;
}

/** CSS gradient preview for palette swatches in the UI. */
export function paletteCss(p: Palette, stops = 7): string {
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const [r, g, b] = paletteColor(p, t).map((v) => Math.round(v * 255));
    parts.push(`rgb(${r},${g},${b}) ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
