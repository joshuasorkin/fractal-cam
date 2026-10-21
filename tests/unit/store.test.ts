import { describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings, SettingsStore, STORAGE_KEY, type KeyValueStorage } from '../../src/params/store';
import { PARAM_SPECS } from '../../src/params/params';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('settings persistence', () => {
  it('survives invalid JSON', () => {
    const s = loadSettings(memoryStorage({ [STORAGE_KEY]: '{not json' }));
    expect(s.effect).toBe('warp');
  });

  it('does not persist the paused flag', () => {
    const st = memoryStorage();
    saveSettings({ ...loadSettings(st), paused: true }, st);
    expect(JSON.parse(st.data[STORAGE_KEY]).paused).toBe(false);
  });

  it('saves changes (debounced) and clamps setParam', async () => {
    vi.useFakeTimers();
    const st = memoryStorage();
    const store = new SettingsStore(null, st);
    store.update({ effect: 'kaleido' });
    store.setParam('intensity', 1e6);
    expect(store.activeParams().intensity).toBe(PARAM_SPECS.intensity.max);
    vi.advanceTimersByTime(300);
    const saved = JSON.parse(st.data[STORAGE_KEY]);
    expect(saved.effect).toBe('kaleido');
    expect(saved.effects.kaleido.intensity).toBe(PARAM_SPECS.intensity.max);
    vi.useRealTimers();
  });

  it('resetEffect restores only the active effect', () => {
    const store = new SettingsStore(null, memoryStorage());
    store.update({ effect: 'glitch' });
    store.setParam('speed', 2.5);
    store.update({ effect: 'warp' });
    store.setParam('speed', 2.5);
    store.resetEffect();
    expect(store.get().effects.warp.speed).toBe(1);
    expect(store.get().effects.glitch.speed).toBe(2.5);
  });
});
