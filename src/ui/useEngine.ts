// React glue: create the Engine imperatively (its own canvas) and expose
// low-frequency state. The engine never triggers per-frame React renders.
import { useEffect, useRef, useState } from 'react';
import { Engine, type EngineStatus, type SourceState } from '../engine/Engine';
import type { SettingsStore } from '../params/store';

declare global {
  interface Window {
    __fractalcam?: { engine: Engine; store: SettingsStore };
  }
}

export function useEngine(store: SettingsStore, mountRef: React.RefObject<HTMLDivElement | null>) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [sourceState, setSourceState] = useState<SourceState>('idle');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'output-canvas';
    mount.appendChild(canvas);
    const e = new Engine(canvas, store);
    const offStatus = e.onStatus(setStatus);
    const offState = e.onSourceState(setSourceState);
    e.init();
    setStatus(e.status);
    setEngine(e);
    window.__fractalcam = { engine: e, store };
    return () => {
      offStatus();
      offState();
      e.dispose();
      canvas.remove();
      if (window.__fractalcam?.engine === e) delete window.__fractalcam;
      setEngine(null);
    };
  }, [store, mountRef]);

  return { engine, status, sourceState };
}

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
