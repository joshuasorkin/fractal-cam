// Clean output route (/output): only the rendered canvas, letterboxed at 16:9,
// no controls, no cursor. Capture this window in OBS (Window Capture).

import { useEffect, useRef } from 'react';
import type { SettingsStore } from '../params/store';
import { WINDOW_ID, type SyncChannel } from '../sync/channel';
import { useEngine } from './useEngine';
import { toggleFullscreen, useShortcuts } from './shortcuts';
import { SYNTHETIC_DEVICE } from '../params/params';

export function OutputApp({ store, channel }: { store: SettingsStore; channel: SyncChannel }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const { engine, status, sourceState } = useEngine(store, mountRef);

  useEffect(() => {
    if (engine) void engine.startSource();
  }, [engine]);

  // Announce ourselves so the control panel hands over the camera and mirrors us.
  useEffect(() => {
    if (!engine) return;
    const hello = () => channel.post({ type: 'output-hello', from: WINDOW_ID });
    const beat = () =>
      channel.post({
        type: 'output-heartbeat',
        from: WINDOW_ID,
        stats: {
          fps: engine.stats.fps,
          renderWidth: engine.stats.renderWidth,
          renderHeight: engine.stats.renderHeight,
          outputWidth: engine.stats.outputWidth,
          outputHeight: engine.stats.outputHeight,
          source: engine.stats.source,
          tracking: engine.stats.tracking,
        },
        status: engine.status && engine.status.level !== 'info' ? engine.status.text : null,
      });
    hello();
    const timer = setInterval(beat, 1000);
    const off = channel.subscribe((m) => {
      if (m.type === 'control-hello') hello();
    });
    const bye = () => channel.post({ type: 'output-bye', from: WINDOW_ID });
    window.addEventListener('pagehide', bye);
    return () => {
      clearInterval(timer);
      off();
      window.removeEventListener('pagehide', bye);
      bye();
    };
  }, [engine, channel]);

  useShortcuts(store, { onFullscreen: () => void toggleFullscreen(document.documentElement) });

  const failed = sourceState === 'error';
  return (
    <div className="output-root" data-testid="output-root">
      <div ref={mountRef} className="output-mount" />
      {/* Shown only when something is wrong; the healthy output is pixels only. */}
      {failed && (
        <div className="output-error" data-testid="output-error">
          <p>{status?.text}</p>
          <button onClick={() => void engine?.startSource()}>Retry camera</button>{' '}
          <button onClick={() => store.update({ deviceId: SYNTHETIC_DEVICE })}>Use test pattern</button>
        </div>
      )}
    </div>
  );
}
