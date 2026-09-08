import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { FADE_START_MS, sleepPhase, type SleepPhase } from '../sleepPhase';
import { loadSleepState, saveSleepState, type SleepState } from '../sleepStorage';
import { canWriteVolume, fadeVolumeToZero } from '../volumeFade';

const DEFAULT_TICK_MS = 1000;

export interface UseSleepTimerOptions {
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
  /** How often to recheck the wall clock while a timer is armed. */
  tickMs?: number;
}

export interface UseSleepTimerResult {
  phase: SleepPhase;
  mode: 'timer' | 'end-of-episode' | null;
  deadlineMs: number | null;
  startTimer: (minutes: number) => void;
  startEndOfEpisode: () => void;
  cancel: () => void;
  /** Call from the video's onEnded handler. */
  notifyEpisodeEnded: () => void;
}

/**
 * The deadline is absolute wall-clock, never a remaining-duration counter:
 * a backgrounded tab throttles or freezes setTimeout, so a countdown timer
 * fires late by an unbounded amount. Storing a target timestamp means every
 * recheck is `now() >= deadlineMs` -- correct regardless of what the
 * browser did while suspended. setInterval below is only a wake-up hint;
 * `sleepPhase` is what decides the truth on every tick, on mount, and on
 * visibilitychange/pageshow.
 */
export function useSleepTimer(
  videoRef: RefObject<HTMLVideoElement | null>,
  onExpire: () => void,
  options: UseSleepTimerOptions = {},
): UseSleepTimerResult {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;

  const [mode, setMode] = useState<'timer' | 'end-of-episode' | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [, setTick] = useState(0);
  // 'end-of-episode' has no wall-clock to derive 'expired' from the way a
  // timer's deadline does -- it is a one-shot event (the episode ending),
  // so whether it has already fired has to be real state, not a ref, or
  // the phase expression below would never see the transition.
  const [endOfEpisodeExpired, setEndOfEpisodeExpired] = useState(false);

  const hasExpiredRef = useRef(false);
  const volumeSnapshotRef = useRef<number | null>(null);
  const cancelFadeRef = useRef<(() => void) | null>(null);
  // Separate from cancelFadeRef: the reduced-motion path sets volume to 0
  // synchronously and has nothing to cancel, but still needs its own
  // one-shot guard so this effect doesn't re-apply it on every tick while
  // still in 'fading'.
  const fadeStartedRef = useRef(false);

  const phase: SleepPhase =
    mode === 'timer' ? sleepPhase(now(), deadlineMs)
    : mode === 'end-of-episode' ? (endOfEpisodeExpired ? 'expired' : 'armed')
    : 'idle';

  // Loaded after mount, on a microtask, the same pattern PreferencesProvider
  // uses and for the same reason: a synchronous setState in an effect body
  // cascades a render React could otherwise avoid.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const stored = loadSleepState();
      if (stored?.mode === 'timer') {
        setMode('timer');
        setDeadlineMs(stored.deadlineMs);
      } else if (stored?.mode === 'end-of-episode') {
        setMode('end-of-episode');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === null) return undefined;
    const recheck = () => setTick((t) => t + 1);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    const interval = setInterval(recheck, tickMs);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', recheck);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', recheck);
    };
  }, [mode, tickMs]);

  const fireExpire = useCallback(() => {
    if (hasExpiredRef.current) return;
    hasExpiredRef.current = true;
    setEndOfEpisodeExpired(true);
    cancelFadeRef.current?.();
    cancelFadeRef.current = null;

    const video = videoRef.current;
    if (video) {
      // Order matters: pause before the caller's onExpire, which is where
      // progress gets flushed and the screen dims. Getting this backwards
      // reintroduces the bug the feature exists to fix -- losing the
      // user's position because they fell asleep first.
      video.pause();
      if (volumeSnapshotRef.current !== null) {
        // So a later manual resume isn't silently muted.
        video.volume = volumeSnapshotRef.current;
      }
    }
    volumeSnapshotRef.current = null;
    onExpire();
  }, [videoRef, onExpire]);

  useEffect(() => {
    if (mode !== 'timer') return;

    if (phase === 'fading' && !fadeStartedRef.current && !hasExpiredRef.current) {
      const video = videoRef.current;
      if (video && canWriteVolume(video)) {
        fadeStartedRef.current = true;
        volumeSnapshotRef.current = video.volume;
        if (prefersReducedMotion()) {
          // Reduced motion removes the animation, never the information:
          // the warning card still appears for the full minute, but the
          // 20-second ramp collapses to an instant drop to silence.
          video.volume = 0;
        } else {
          cancelFadeRef.current = fadeVolumeToZero(video, FADE_START_MS, () => {
            cancelFadeRef.current = null;
          });
        }
      }
    }

    if (phase === 'expired') {
      fireExpire();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- videoRef is a stable ref object
  }, [phase, mode, fireExpire]);

  const resetTimerState = () => {
    volumeSnapshotRef.current = null;
    cancelFadeRef.current?.();
    cancelFadeRef.current = null;
    fadeStartedRef.current = false;
    hasExpiredRef.current = false;
    setEndOfEpisodeExpired(false);
  };

  const startTimer = useCallback(
    (minutes: number) => {
      resetTimerState();
      const deadline = now() + minutes * 60_000;
      setMode('timer');
      setDeadlineMs(deadline);
      const state: SleepState = { mode: 'timer', deadlineMs: deadline };
      saveSleepState(state);
    },
    [now],
  );

  const startEndOfEpisode = useCallback(() => {
    resetTimerState();
    setMode('end-of-episode');
    setDeadlineMs(null);
    saveSleepState({ mode: 'end-of-episode' });
  }, []);

  const cancel = useCallback(() => {
    const video = videoRef.current;
    if (video && volumeSnapshotRef.current !== null) {
      video.volume = volumeSnapshotRef.current;
    }
    resetTimerState();
    setMode(null);
    setDeadlineMs(null);
    saveSleepState(null);
  }, [videoRef]);

  const notifyEpisodeEnded = useCallback(() => {
    if (mode !== 'end-of-episode') return;
    fireExpire();
  }, [mode, fireExpire]);

  return { phase, mode, deadlineMs, startTimer, startEndOfEpisode, cancel, notifyEpisodeEnded };
}
