import type { FaceFrame, PoseFrame } from './signals';

export type WorkerRequest =
  | { type: 'init'; wasmBase: string; faceModel: string; poseModel: string; face: boolean; pose: boolean; delegate: 'auto' | 'CPU' | 'GPU' }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; runFace: boolean; runPose: boolean }
  | { type: 'dispose' };

export type WorkerResponse =
  | { type: 'ready'; delegates: string[] }
  | { type: 'result'; id: number; face: FaceFrame | null | undefined; pose: PoseFrame | null | undefined; ms: number }
  | { type: 'error'; message: string; id?: number };
