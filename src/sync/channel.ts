// Cross-window protocol between the control panel and the clean /output window.
// Both windows are same-origin, so BroadcastChannel reaches every open FractalCam window.

import type { Settings } from '../params/params';

export interface OutputStats {
  fps: number;
  renderWidth: number;
  renderHeight: number;
  outputWidth: number;
  outputHeight: number;
  source: string;
  tracking: string;
}

export type SyncMessage =
  | { type: 'settings'; from: string; settings: Settings }
  | { type: 'output-hello'; from: string }
  | { type: 'output-heartbeat'; from: string; stats: OutputStats | null; status: string | null }
  | { type: 'output-bye'; from: string }
  | { type: 'control-hello'; from: string };

export const CHANNEL_NAME = 'fractalcam-v1';

export const WINDOW_ID = Math.random().toString(36).slice(2, 10);

export class SyncChannel {
  private bc: BroadcastChannel | null;
  private listeners = new Set<(m: SyncMessage) => void>();

  constructor() {
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    if (this.bc) {
      this.bc.onmessage = (e: MessageEvent<SyncMessage>) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object' || msg.from === WINDOW_ID) return;
        for (const l of this.listeners) l(msg);
      };
    }
  }

  post(msg: SyncMessage) {
    this.bc?.postMessage(msg);
  }

  subscribe(fn: (m: SyncMessage) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  close() {
    this.bc?.close();
    this.bc = null;
    this.listeners.clear();
  }
}
