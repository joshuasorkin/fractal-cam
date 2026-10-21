import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SettingsStore } from '../params/store';
import { WINDOW_ID, type OutputStats, type SyncChannel } from '../sync/channel';
import { useEngine } from './useEngine';
import { toggleFullscreen, useShortcuts } from './shortcuts';
import { EFFECT_IDS, EFFECT_INFO, PARAM_SPECS, RENDER_SCALES, SYNTHETIC_DEVICE, type ParamKey } from '../params/params';
import { PALETTES, paletteCss } from '../params/palettes';
import { cameraPermissionState, listCameras, type CameraDevice } from '../capture/camera';
import type { Engine, EngineStats } from '../engine/Engine';

const OUTPUT_WINDOW_NAME = 'fractalcam-output';
const HEARTBEAT_TIMEOUT_MS = 3500;

interface Props {
  store: SettingsStore;
  channel: SyncChannel;
}

export function ControlApp({ store, channel }: Props) {
  const settings = useSyncExternalStore(store.subscribe, store.get);
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLVideoElement>(null);
  const { engine, status, sourceState } = useEngine(store, mountRef);
  const [uiHidden, setUiHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [outputLive, setOutputLive] = useState(false);
  const [outputStats, setOutputStats] = useState<OutputStats | null>(null);
  const [outputStatus, setOutputStatus] = useState<string | null>(null);
  const [mirrorOk, setMirrorOk] = useState(false);
  const outputWin = useRef<Window | null>(null);
  const lastBeat = useRef(0);
  const liveRef = useRef(false);

  const refreshCameras = useCallback(() => {
    listCameras().then(setCameras).catch(() => setCameras([]));
  }, []);

  // ---- start the source: automatically if permission was granted before ----
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    (async () => {
      const perm = await cameraPermissionState();
      if (cancelled || engine.sourceState !== 'idle') return;
      // Granted before: start right away. Denied before: starting surfaces the
      // "blocked" explanation instead of a button that cannot work.
      if (perm === 'granted' || perm === 'denied' || store.get().deviceId === SYNTHETIC_DEVICE) await engine.startSource();
      refreshCameras();
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, store, refreshCameras]);

  useEffect(() => {
    if (sourceState === 'live') refreshCameras();
  }, [sourceState, refreshCameras]);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshCameras);
  }, [refreshCameras]);

  // ---- output window coordination ----------------------------------------------
  // While a clean output window is alive it owns the camera; this window
  // releases it (one acquisition, one GPU pipeline) and mirrors that output.
  useEffect(() => {
    if (!engine) return;
    const goLive = () => {
      lastBeat.current = performance.now();
      if (liveRef.current) return;
      liveRef.current = true;
      engine.suspend();
      setOutputLive(true);
    };
    const goDead = () => {
      if (!liveRef.current) return;
      liveRef.current = false;
      lastBeat.current = 0;
      setOutputLive(false);
      setOutputStats(null);
      setOutputStatus(null);
      void engine.resume();
    };
    const off = channel.subscribe((msg) => {
      if (msg.type === 'output-hello') {
        goLive();
        store.broadcast();
      } else if (msg.type === 'output-heartbeat') {
        goLive();
        setOutputStats(msg.stats);
        setOutputStatus(msg.status);
      } else if (msg.type === 'output-bye') {
        goDead();
      }
    });
    channel.post({ type: 'control-hello', from: WINDOW_ID });
    const timer = setInterval(() => {
      if (liveRef.current && performance.now() - lastBeat.current > HEARTBEAT_TIMEOUT_MS) goDead();
    }, 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [engine, channel, store]);

  // Mirror the output window's canvas into our preview (only possible when we opened it).
  useEffect(() => {
    const video = mirrorRef.current;
    if (!outputLive || !video) {
      setMirrorOk(false);
      if (video) video.srcObject = null;
      return;
    }
    let stopped = false;
    let stream: MediaStream | null = null;
    const attach = () => {
      if (stopped) return;
      try {
        const win = outputWin.current;
        const canvas = win && !win.closed ? win.document.querySelector('canvas') : null;
        if (!canvas) {
          setMirrorOk(false);
          retry = setTimeout(attach, 700);
          return;
        }
        stream = canvas.captureStream(30);
        video.srcObject = stream;
        void video.play().catch(() => {});
        setMirrorOk(true);
      } catch {
        setMirrorOk(false);
      }
    };
    let retry = setTimeout(attach, 300);
    return () => {
      stopped = true;
      clearTimeout(retry);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [outputLive]);

  const openOutput = () => {
    const existing = outputWin.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const url = `${import.meta.env.BASE_URL}output`;
    outputWin.current = window.open(url, OUTPUT_WINDOW_NAME, 'popup=yes,width=1280,height=720');
    if (!outputWin.current) {
      alert('The browser blocked the popup. Allow popups for localhost, or open /output manually.');
    }
  };

  const closeOutput = () => {
    outputWin.current?.close();
    outputWin.current = null;
  };

  const onFullscreen = useCallback(() => {
    if (stageRef.current) void toggleFullscreen(stageRef.current);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useShortcuts(store, { onFullscreen, onToggleUI: () => setUiHidden((v) => !v) });

  const params = settings.effects[settings.effect];
  const info = EFFECT_INFO[settings.effect];
  const physical = cameras.filter((c) => c.deviceId);
  const selectedVirtual = cameras.find((c) => c.deviceId === settings.deviceId)?.isVirtual;

  const start = (device?: string) => {
    if (device !== undefined && device !== settings.deviceId) store.update({ deviceId: device });
    void engine?.startSource();
  };

  return (
    <div className={`app ${uiHidden ? 'ui-hidden' : ''}`} data-testid="control-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-orb" />
          FractalCam
        </div>
        <StatsBar engine={engine} outputStats={outputLive ? outputStats : null} paused={settings.paused} />
      </header>

      <main className="layout">
        <section className="stage-wrap">
          <div
            ref={stageRef}
            className={`stage ${fullscreen ? 'is-fullscreen' : ''}`}
            data-testid="stage"
            onDoubleClick={onFullscreen}
          >
            <div ref={mountRef} className={`canvas-mount ${outputLive ? 'hidden' : ''}`} />
            <video ref={mirrorRef} className={`mirror ${outputLive && mirrorOk ? '' : 'hidden'}`} muted playsInline />

            {!fullscreen && outputLive && !mirrorOk && (
              <div className="overlay">
                <div className="card">
                  <h2>Output window is live</h2>
                  <p>The camera and effects are running in the separate output window (opened outside this panel, so no preview here). Controls still apply.</p>
                </div>
              </div>
            )}
            {!fullscreen && !outputLive && sourceState === 'idle' && (
              <div className="overlay" data-testid="start-overlay">
                <div className="card">
                  <h2>Become a fractal.</h2>
                  <p>FractalCam needs your webcam. Video is processed locally on your GPU — nothing is uploaded.</p>
                  <div className="row">
                    <button className="primary" onClick={() => start()} data-testid="enable-camera">
                      Enable camera
                    </button>
                    <button onClick={() => start(SYNTHETIC_DEVICE)}>Use test pattern</button>
                  </div>
                </div>
              </div>
            )}
            {!fullscreen && !outputLive && sourceState === 'error' && (
              <div className="overlay" data-testid="error-overlay">
                <div className="card error">
                  <h2>Camera unavailable</h2>
                  <p>{status?.text}</p>
                  <div className="row">
                    <button className="primary" onClick={() => start()}>
                      Retry
                    </button>
                    <button onClick={() => start(SYNTHETIC_DEVICE)}>Use test pattern</button>
                  </div>
                </div>
              </div>
            )}
            {!fullscreen && sourceState === 'starting' && !outputLive && <div className="overlay subtle">Waiting for camera permission…</div>}
            {settings.paused && !fullscreen && <div className="badge paused">PAUSED · Space</div>}
          </div>

          <div className={`status-area ${status?.level ?? (outputStatus ? 'warn' : 'info')}`} role="status" data-testid="status">
            {outputLive
              ? outputStatus
                ? `Output window: ${outputStatus}`
                : 'Output window live — capture the "FractalCam Output" window in OBS.'
              : status
                ? status.text
                : sourceState === 'live'
                  ? 'Live. Open the output window to send this to OBS.'
                  : 'Ready.'}
          </div>
          <div className="shortcuts">
            <kbd>1</kbd>–<kbd>4</kbd> effect <kbd>Space</kbd> pause <kbd>R</kbd> randomize <kbd>F</kbd> fullscreen <kbd>H</kbd> hide controls
          </div>
        </section>

        <aside className="panel" data-testid="panel">
          <Section title="Effect">
            <div className="effects">
              {EFFECT_IDS.map((id) => (
                <button
                  key={id}
                  className={`effect-btn ${settings.effect === id ? 'active' : ''}`}
                  onClick={() => store.update({ effect: id })}
                  data-testid={`effect-${id}`}
                  aria-pressed={settings.effect === id}
                >
                  <span className="key">{EFFECT_INFO[id].key}</span>
                  <span className="name">{EFFECT_INFO[id].name}</span>
                  <span className="blurb">{EFFECT_INFO[id].blurb}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title={`Parameters · ${info.name}`}>
            {(['intensity', 'speed', 'complexity', 'distortion', 'saturation', 'camMix', 'feedback'] as ParamKey[]).map((key) => (
              <Slider
                key={key}
                param={key}
                label={key === 'complexity' ? info.complexityLabel : PARAM_SPECS[key].label}
                value={params[key]}
                onChange={(v) => store.setParam(key, v)}
              />
            ))}
            <div className="label">Palette</div>
            <div className="palettes" role="radiogroup">
              {PALETTES.map((p, i) => (
                <button
                  key={p.name}
                  className={`swatch ${params.palette === i ? 'active' : ''}`}
                  style={{ background: paletteCss(p) }}
                  title={p.name}
                  aria-label={p.name}
                  aria-checked={params.palette === i}
                  role="radio"
                  onClick={() => store.setParam('palette', i)}
                />
              ))}
            </div>
            <div className="palette-name">{PALETTES[params.palette]?.name}</div>
            <div className="row">
              <button onClick={() => store.randomize()} data-testid="randomize">
                Randomize <kbd>R</kbd>
              </button>
              <button onClick={() => store.resetEffect()} data-testid="reset">
                Reset to defaults
              </button>
            </div>
          </Section>

          <Section title="Body & face">
            <Toggle label="Face tracking" hint="mouth, brows, head, blinks" checked={settings.faceTracking} onChange={(v) => store.update({ faceTracking: v })} testId="toggle-face" />
            <Toggle label="Body tracking" hint="arms & hands (extra GPU)" checked={settings.poseTracking} onChange={(v) => store.update({ poseTracking: v })} testId="toggle-pose" />
            <Toggle label="Motion responsive" hint="movement drives intensity" checked={settings.motionResponsive} onChange={(v) => store.update({ motionResponsive: v })} testId="toggle-motion" />
          </Section>

          <Section title="Camera">
            <select
              value={settings.deviceId}
              onChange={(e) => store.update({ deviceId: e.target.value })}
              data-testid="device-select"
              aria-label="Camera"
            >
              <option value="">Default camera</option>
              {physical.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.isVirtual ? `⚠ ${c.label} (virtual — feedback loop!)` : c.label}
                </option>
              ))}
              <option value={SYNTHETIC_DEVICE}>Synthetic test pattern (no camera)</option>
            </select>
            {selectedVirtual && <p className="warn-text">This looks like a virtual camera. Using OBS Virtual Camera as input feeds the output back into itself.</p>}
            <Toggle label="Mirror (selfie view)" checked={settings.mirror} onChange={(v) => store.update({ mirror: v })} />
          </Section>

          <Section title="Output">
            <div className="row">
              {outputLive ? (
                <button className="primary" onClick={closeOutput} data-testid="close-output">
                  Close output window
                </button>
              ) : (
                <button className="primary" onClick={openOutput} data-testid="open-output">
                  Open output window
                </button>
              )}
              <button onClick={onFullscreen}>
                Fullscreen <kbd>F</kbd>
              </button>
            </div>
            <Toggle label="Adaptive quality" hint="lower internal resolution if FPS drops" checked={settings.adaptiveQuality} onChange={(v) => store.update({ adaptiveQuality: v })} />
            <label className="field">
              <span>Render scale</span>
              <select
                value={settings.renderScale}
                disabled={settings.adaptiveQuality}
                onChange={(e) => store.update({ renderScale: Number(e.target.value) })}
              >
                {RENDER_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {Math.round(s * 100)}% ({Math.round(1280 * s)}×{Math.round(720 * s)})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Frame cap</span>
              <select value={settings.fpsCap} onChange={(e) => store.update({ fpsCap: Number(e.target.value) === 60 ? 60 : 30 })}>
                <option value={30}>30 fps (Zoom)</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
            <button className="link" onClick={() => store.resetAll()}>
              Reset all settings
            </button>
          </Section>
        </aside>
      </main>
      {uiHidden && <div className="hint-fade">Press H to show controls</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Slider({ param, label, value, onChange }: { param: ParamKey; label: string; value: number; onChange: (v: number) => void }) {
  const spec = PARAM_SPECS[param];
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <output>{spec.integer ? value : value.toFixed(2)}</output>
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={`slider-${param}`}
      />
    </label>
  );
}

function Toggle({ label, hint, checked, onChange, testId }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="track" />
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

/** Only this component re-renders on stats ticks (2 Hz). */
function StatsBar({ engine, outputStats, paused }: { engine: Engine | null; outputStats: OutputStats | null; paused: boolean }) {
  const [stats, setStats] = useState<EngineStats | null>(null);
  useEffect(() => {
    if (!engine) return;
    return engine.onStats(setStats);
  }, [engine]);
  const s = outputStats ?? stats;
  const fps = s?.fps ?? 0;
  const fpsClass = fps >= 28 ? 'good' : fps >= 20 ? 'ok' : 'bad';
  return (
    <div className="stats" data-testid="stats">
      {outputStats && <span className="chip live">OUTPUT WINDOW</span>}
      <span className={`chip ${fpsClass}`} data-testid="fps">
        {fps.toFixed(0)} FPS
      </span>
      <span className="chip" data-testid="render-res">
        render {s?.renderWidth ?? 0}×{s?.renderHeight ?? 0}
      </span>
      <span className="chip">
        out {s?.outputWidth ?? 1280}×{s?.outputHeight ?? 720}
      </span>
      {stats && !outputStats && stats.cameraWidth > 0 && (
        <span className="chip">
          cam {stats.cameraWidth}×{stats.cameraHeight}
        </span>
      )}
      <span className="chip wide" title={s?.tracking}>
        tracking: {s?.tracking ?? 'off'}
      </span>
      {stats && !outputStats && (
        <span className="chip meter" title="motion energy">
          motion <i style={{ width: `${Math.round((stats.motion ?? 0) * 100)}%` }} />
        </span>
      )}
      {paused && <span className="chip ok">paused</span>}
    </div>
  );
}
