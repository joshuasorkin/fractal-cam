// Pure mapping from raw MediaPipe results to smoothed performance signals.

/** Minimal face data sent from the worker (video coordinates: 0..1, y down, unmirrored). */
export interface FaceFrame {
  blend: Record<string, number>;
  /** 4x4 column-major facial transformation matrix, if available. */
  matrix: number[] | null;
  nose: [number, number];
  eyes: [number, number];
  bbox: [number, number, number, number];
}

export interface PoseFrame {
  leftWrist: [number, number, number]; // x, y, visibility
  rightWrist: [number, number, number];
  leftShoulder: [number, number, number];
  rightShoulder: [number, number, number];
}

export interface TrackingSignals {
  facePresent: number;
  mouth: number;
  brow: number;
  blink: number;
  smile: number;
  yaw: number;
  pitch: number;
  roll: number;
  faceX: number;
  faceY: number;
  faceSize: number;
  eyeX: number;
  eyeY: number;
  gazeX: number;
  gazeY: number;
  pulse: number;
  posePresent: number;
  leftHandX: number;
  leftHandY: number;
  rightHandX: number;
  rightHandY: number;
  armRaise: number;
}

export function neutralSignals(): TrackingSignals {
  return {
    facePresent: 0,
    mouth: 0,
    brow: 0,
    blink: 0,
    smile: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    faceX: 0.5,
    faceY: 0.45,
    faceSize: 0.4,
    eyeX: 0.5,
    eyeY: 0.4,
    gazeX: 0,
    gazeY: 0,
    pulse: 0,
    posePresent: 0,
    leftHandX: 0.3,
    leftHandY: 0.8,
    rightHandX: 0.7,
    rightHandY: 0.8,
    armRaise: 0,
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const norm = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

/**
 * Euler angles (radians) from MediaPipe's column-major 4x4 transform.
 * yaw: turning the head left/right, pitch: nodding, roll: tilting.
 */
export function eulerFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const r = (row: number, col: number) => m[col * 4 + row];
  // Remove scale from the rotation columns.
  const sx = Math.hypot(r(0, 0), r(1, 0), r(2, 0)) || 1;
  const sy = Math.hypot(r(0, 1), r(1, 1), r(2, 1)) || 1;
  const sz = Math.hypot(r(0, 2), r(1, 2), r(2, 2)) || 1;
  const r00 = r(0, 0) / sx, r10 = r(1, 0) / sx, r20 = r(2, 0) / sx;
  const r21 = r(2, 1) / sy, r22 = r(2, 2) / sz;
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -r20))),
    pitch: Math.atan2(r21, r22),
    roll: Math.atan2(r10, r00),
  };
}

/** Raw (unsmoothed) target values for face-driven signals. */
export function faceTargets(f: FaceFrame) {
  const b = (k: string) => f.blend[k] ?? 0;
  const angles = f.matrix ? eulerFromMatrix(f.matrix) : { yaw: 0, pitch: 0, roll: 0 };
  // Fall back to the eye line for roll if no matrix is available.
  return {
    mouth: norm(b('jawOpen'), 0.04, 0.55),
    brow: norm(Math.max(b('browInnerUp'), (b('browOuterUpLeft') + b('browOuterUpRight')) / 2), 0.08, 0.65),
    blink: clamp01((b('eyeBlinkLeft') + b('eyeBlinkRight')) / 2),
    smile: norm((b('mouthSmileLeft') + b('mouthSmileRight')) / 2, 0.1, 0.8),
    gazeX: Math.max(-1, Math.min(1, (b('eyeLookOutLeft') - b('eyeLookInLeft') + b('eyeLookInRight') - b('eyeLookOutRight')) * 1.5)),
    gazeY: Math.max(-1, Math.min(1, ((b('eyeLookUpLeft') + b('eyeLookUpRight')) - (b('eyeLookDownLeft') + b('eyeLookDownRight'))) * 1.5)),
    ...angles,
    faceX: f.nose[0],
    faceY: f.nose[1],
    faceSize: Math.max(0.05, f.bbox[3] - f.bbox[1]),
    eyeX: f.eyes[0],
    eyeY: f.eyes[1],
  };
}

export function poseTargets(p: PoseFrame) {
  const vis = (l: [number, number, number]) => l[2] > 0.5;
  const shoulderY = (p.leftShoulder[1] + p.rightShoulder[1]) / 2;
  // How far above the shoulders the wrists are, in units of shoulder width.
  const sw = Math.max(0.05, Math.abs(p.leftShoulder[0] - p.rightShoulder[0]));
  const raise = (w: [number, number, number]) => (vis(w) ? clamp01((shoulderY - w[1]) / sw + 0.3) : 0);
  return {
    leftHandX: p.leftWrist[0],
    leftHandY: p.leftWrist[1],
    rightHandX: p.rightWrist[0],
    rightHandY: p.rightWrist[1],
    armRaise: Math.max(raise(p.leftWrist), raise(p.rightWrist)),
    visible: vis(p.leftShoulder) || vis(p.rightShoulder),
  };
}

/** Frame-rate independent exponential smoothing toward a target. */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

type Targets = Partial<Record<keyof TrackingSignals, number>>;

/**
 * Holds latest targets from (slow, irregular) inference and smooths them every
 * render frame. When tracking drops out, signals relax to neutral instead of
 * freezing or snapping.
 */
export class SignalSmoother {
  readonly signals: TrackingSignals = neutralSignals();
  private faceTarget: Targets | null = null;
  private poseTarget: Targets | null = null;
  private faceSeenAt = -Infinity;
  private poseSeenAt = -Infinity;
  private blinkArmed = true;
  holdSeconds = 0.5;

  pushFace(f: FaceFrame | null, now: number) {
    if (!f) return;
    this.faceTarget = faceTargets(f);
    this.faceSeenAt = now;
  }

  pushPose(p: PoseFrame | null, now: number) {
    if (!p) return;
    const t = poseTargets(p);
    if (!t.visible) return;
    this.poseTarget = t;
    this.poseSeenAt = now;
  }

  clear() {
    this.faceTarget = null;
    this.poseTarget = null;
    this.faceSeenAt = this.poseSeenAt = -Infinity;
  }

  tick(now: number, dt: number) {
    const s = this.signals;
    const neutral = neutralSignals();
    const faceOk = this.faceTarget !== null && now - this.faceSeenAt < this.holdSeconds;
    const poseOk = this.poseTarget !== null && now - this.poseSeenAt < this.holdSeconds;
    const ft: Targets = faceOk ? this.faceTarget! : {};
    const pt: Targets = poseOk ? this.poseTarget! : {};

    s.facePresent = smoothToward(s.facePresent, faceOk ? 1 : 0, dt, 0.25);
    s.posePresent = smoothToward(s.posePresent, poseOk ? 1 : 0, dt, 0.25);

    const faceKeys = ['mouth', 'brow', 'smile', 'yaw', 'pitch', 'roll', 'faceX', 'faceY', 'faceSize', 'eyeX', 'eyeY', 'gazeX', 'gazeY'] as const;
    for (const k of faceKeys) {
      const tau = k === 'mouth' ? 0.06 : k === 'faceX' || k === 'faceY' ? 0.1 : 0.12;
      s[k] = smoothToward(s[k], ft[k] ?? neutral[k], dt, faceOk ? tau : 0.6);
    }
    // Blink is a fast event: barely smoothed.
    const blinkT = ft.blink ?? 0;
    s.blink = smoothToward(s.blink, blinkT, dt, 0.03);
    if (faceOk && this.blinkArmed && blinkT > 0.55) {
      s.pulse = 1;
      this.blinkArmed = false;
    } else if (blinkT < 0.3) {
      this.blinkArmed = true;
    }
    s.pulse *= Math.exp(-dt * 2.5);

    const poseKeys = ['leftHandX', 'leftHandY', 'rightHandX', 'rightHandY', 'armRaise'] as const;
    for (const k of poseKeys) s[k] = smoothToward(s[k], pt[k] ?? neutral[k], dt, poseOk ? 0.1 : 0.6);
  }
}
