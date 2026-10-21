// Mapping between output space (16:9, uv origin bottom-left) and camera texture
// space, handling aspect-ratio "cover" cropping and selfie mirroring.

export interface CamUV {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export function computeCamUV(videoW: number, videoH: number, outW: number, outH: number, mirror: boolean): CamUV {
  let sx = 1;
  let sy = 1;
  if (videoW > 0 && videoH > 0) {
    const camAspect = videoW / videoH;
    const outAspect = outW / outH;
    if (camAspect > outAspect) sx = outAspect / camAspect; // camera wider: crop sides
    else sy = camAspect / outAspect; // camera taller (e.g. 4:3): crop top/bottom
  }
  const ox = (1 - sx) / 2;
  const oy = (1 - sy) / 2;
  return mirror ? { scaleX: -sx, scaleY: sy, offsetX: ox + sx, offsetY: oy } : { scaleX: sx, scaleY: sy, offsetX: ox, offsetY: oy };
}

/** Video landmark (x right, y down, 0..1, unmirrored) -> output uv (y up). */
export function videoToOutput(m: CamUV, x: number, y: number): [number, number] {
  const cx = x;
  const cy = 1 - y;
  return [(cx - m.offsetX) / m.scaleX, (cy - m.offsetY) / m.scaleY];
}
