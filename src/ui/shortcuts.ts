import { useEffect } from 'react';
import { EFFECT_IDS } from '../params/params';
import type { SettingsStore } from '../params/store';
import { useLatest } from './useEngine';

export interface ShortcutHandlers {
  onFullscreen: () => void;
  onToggleUI?: () => void;
}

/** 1–4 effects, Space pause, R randomize, F fullscreen, H hide UI. */
export function useShortcuts(store: SettingsStore, handlers: ShortcutHandlers) {
  const h = useLatest(handlers);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '4') {
        store.update({ effect: EFFECT_IDS[Number(k) - 1] });
      } else if (e.code === 'Space') {
        store.update({ paused: !store.get().paused });
      } else if (k === 'r') {
        store.randomize();
      } else if (k === 'f') {
        h.current.onFullscreen();
      } else if (k === 'h' && h.current.onToggleUI) {
        h.current.onToggleUI();
      } else {
        return;
      }
      e.preventDefault();
      // Keep focus off buttons so Space doesn't also "click" the last one used.
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [store, h]);
}

export async function toggleFullscreen(el: HTMLElement) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* fullscreen denied (e.g. not triggered by a user gesture) */
  }
}
