import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'dragonflow:theme';

function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
  return 'system';
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredPreference()),
  );

  const applyTheme = useCallback((pref: ThemePreference) => {
    const eff = resolveTheme(pref);
    setResolved(eff);
    document.documentElement.setAttribute('data-theme', eff);
  }, []);

  useEffect(() => {
    applyTheme(preference);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      if (preference === 'system') {
        applyTheme('system');
      }
    };
    mq?.addEventListener?.('change', handleMediaChange);
    return () => mq?.removeEventListener?.('change', handleMediaChange);
  }, [preference, applyTheme]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setPreference(next);
      applyTheme(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore storage errors
      }
    },
    [applyTheme],
  );

  const cycleTheme = useCallback(() => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setTheme(next);
  }, [preference, setTheme]);

  return { preference, resolved, setTheme, cycleTheme };
}
