// Observable settings store: single source of truth for parameters in a window.
// Persists to localStorage and mirrors changes to other FractalCam windows.

import {
  defaultSettings,
  sanitizeEffectParams,
  sanitizeSettings,
  randomizeEffectParams,
  DEFAULT_EFFECT_PARAMS,
  type EffectId,
  type EffectParams,
  type ParamKey,
  type Settings,
  clampParam,
} from './params';
import { WINDOW_ID, type SyncChannel } from '../sync/channel';

export const STORAGE_KEY = 'fractalcam.settings.v1';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: KeyValueStorage | null = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings, storage: KeyValueStorage | null = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ ...s, paused: false }));
  } catch {
    /* storage full or blocked: preferences just won't persist */
  }
}

export class SettingsStore {
  private state: Settings;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private channel: SyncChannel | null,
    private storage: KeyValueStorage | null = safeStorage(),
  ) {
    this.state = loadSettings(storage);
    channel?.subscribe((msg) => {
      if (msg.type === 'settings') this.apply(sanitizeSettings(msg.settings), false);
    });
  }

  get = (): Settings => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  /** Push the current state to other windows (e.g. when a new output window appears). */
  broadcast() {
    this.channel?.post({ type: 'settings', from: WINDOW_ID, settings: this.state });
  }

  private apply(next: Settings, local: boolean) {
    this.state = next;
    for (const l of this.listeners) l();
    if (local) {
      this.broadcast();
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => saveSettings(this.state, this.storage), 250);
    }
  }

  update(patch: Partial<Omit<Settings, 'effects'>>) {
    this.apply(sanitizeSettings({ ...this.state, ...patch }), true);
  }

  activeParams(): EffectParams {
    return this.state.effects[this.state.effect];
  }

  setParam(key: ParamKey, value: number) {
    const id = this.state.effect;
    const params = { ...this.state.effects[id], [key]: clampParam(key, value) };
    this.setEffectParams(id, params);
  }

  setEffectParams(id: EffectId, params: EffectParams) {
    this.apply({ ...this.state, effects: { ...this.state.effects, [id]: sanitizeEffectParams(params, id) } }, true);
  }

  randomize() {
    this.setEffectParams(this.state.effect, randomizeEffectParams(this.state.effect));
  }

  /** Reset the active effect's parameters (other settings such as camera choice are kept). */
  resetEffect() {
    this.setEffectParams(this.state.effect, structuredClone(DEFAULT_EFFECT_PARAMS[this.state.effect]));
  }

  resetAll() {
    const d = defaultSettings();
    this.apply({ ...d, deviceId: this.state.deviceId }, true);
  }
}
