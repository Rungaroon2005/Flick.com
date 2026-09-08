'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from './prefs';

interface PreferencesApi {
  prefs: Prefs;
  setNight: (value: boolean) => void;
  setAutoplayNext: (value: boolean) => void;
  setAutoSkip: (value: boolean) => void;
}

const PreferencesContext = createContext<PreferencesApi | null>(null);

/**
 * One preferences store for the whole app, mounted at the root layout
 * rather than inside the (app) tab-shell: /player/[id] and /movie/[id] sit
 * outside that route group, and Night Mode's dimming applies to every
 * route, not just the tab-bar ones.
 *
 * State starts at DEFAULT_PREFS unconditionally -- the same value on the
 * server and on the client's hydration-time render -- and only diverges
 * from it in an effect that runs after hydration commits. A lazy
 * `useState(loadPrefs)` initializer would read localStorage during the
 * hydration render too, which is exactly the split-brain that produces a
 * hydration-mismatch warning on any descendant that renders differently
 * for night: true vs false.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Resolved on a microtask rather than calling setState synchronously in
    // the effect body -- the same pattern useAppleSignIn uses for its SDK
    // probe, and for the same reason: a synchronous setState here would
    // cascade a render React could otherwise avoid.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setPrefs(loadPrefs());
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Guarded on `loaded`: without it, this effect's FIRST run (in the same
    // commit as the mount effect above, before that effect's setPrefs has
    // taken effect) would still close over the DEFAULT_PREFS render and
    // clear the `data-night="on"` attribute the pre-paint boot script
    // already set -- undoing the one thing that feature exists to prevent.
    if (!loaded) return;
    if (prefs.night) {
      document.documentElement.setAttribute('data-night', 'on');
    } else {
      document.documentElement.removeAttribute('data-night');
    }
  }, [loaded, prefs.night]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const setNight = useCallback(
    (value: boolean) => {
      // Coupled in one write, not two separate setters racing: Night Mode's
      // side effects are Prefs writes, not separate state.
      update(value ? { night: true, autoplayNext: false } : { night: false });
    },
    [update],
  );

  const setAutoplayNext = useCallback(
    (value: boolean) => update({ autoplayNext: value }),
    [update],
  );

  const setAutoSkip = useCallback((value: boolean) => update({ autoSkip: value }), [update]);

  const api = useMemo(
    () => ({ prefs, setNight, setAutoplayNext, setAutoSkip }),
    [prefs, setNight, setAutoplayNext, setAutoSkip],
  );

  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesApi {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside a PreferencesProvider');
  return context;
}
