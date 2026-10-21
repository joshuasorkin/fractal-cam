// Synthetic animated "performer" for exercising the pipeline without a webcam.
// It is a clearly labelled test pattern, never a substitute for the real camera.

import { wrapStream, type VideoSource } from './camera';

export async function openSyntheticSource(width = 640, height = 360): Promise<VideoSource> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const start = performance.now();
  let running = true;

  const draw = () => {
    if (!running) return;
    const t = (performance.now() - start) / 1000;
    const w = width;
    const h = height;

    // Background: slow gradient room with a few "furniture" blocks so edges exist.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2a3446');
    g.addColorStop(1, '#5b4a3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7a6a55';
    ctx.fillRect(w * 0.05, h * 0.55, w * 0.18, h * 0.45);
    ctx.fillStyle = '#c9c0a8';
    ctx.fillRect(w * 0.78, h * 0.12, w * 0.14, h * 0.2);

    // Performer: sways, nods, opens mouth, waves an arm.
    const cx = w * (0.5 + 0.12 * Math.sin(t * 0.7));
    const cy = h * (0.42 + 0.03 * Math.sin(t * 1.3));
    const r = h * 0.17;

    ctx.fillStyle = '#3d6fb6'; // torso
    ctx.beginPath();
    ctx.ellipse(cx, h * 1.02, r * 2.1, r * 1.9, 0, Math.PI, 0);
    ctx.fill();

    const wave = Math.sin(t * 3);
    ctx.strokeStyle = '#e0b08a'; // waving arm
    ctx.lineWidth = r * 0.35;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + r * 1.6, h * 0.82);
    ctx.lineTo(cx + r * 2.3, h * 0.55);
    ctx.lineTo(cx + r * (2.6 + 0.5 * wave), h * (0.3 - 0.05 * wave));
    ctx.stroke();

    ctx.save(); // head with roll
    ctx.translate(cx, cy);
    ctx.rotate(0.25 * Math.sin(t * 0.9));
    ctx.fillStyle = '#e8b896';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.82, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1b12'; // hair
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.85, r * 0.5, 0, Math.PI, 0);
    ctx.fill();
    const blink = Math.sin(t * 2.1) > 0.97 ? 0.1 : 1;
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.33, -r * 0.1, r * 0.16, r * 0.11 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#222';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.33 + r * 0.05 * Math.sin(t), -r * 0.1, r * 0.06 * blink, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#7a2230'; // mouth opens and closes
    ctx.beginPath();
    ctx.ellipse(0, r * 0.45, r * 0.3, r * (0.04 + 0.2 * Math.max(0, Math.sin(t * 1.7))), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Label so a recording can never be mistaken for the real camera.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${Math.round(h * 0.045)}px sans-serif`;
    ctx.fillText('SYNTHETIC TEST PATTERN', w * 0.03, h * 0.07);
  };

  const timer = setInterval(draw, 1000 / 30);
  draw();
  const stream = canvas.captureStream(30);
  return wrapStream('synthetic', 'Synthetic test pattern', stream, () => {
    running = false;
    clearInterval(timer);
  });
}
