import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSleepTimer } from './useSleepTimer';
import { SLEEP_STORAGE_KEY } from '../sleepStorage';
import * as volumeFade from '../volumeFade';

vi.mock('../volumeFade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../volumeFade')>();
  return {
    ...actual,
    canWriteVolume: vi.fn(() => true),
    fadeVolumeToZero: vi.fn(() => vi.fn()),
  };
});

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.volume = 1;
  vi.spyOn(video, 'pause').mockImplementation(() => {});
  return video;
}

/** Flushes the hook's microtask-deferred mount-load effect. */
async function flushLoad() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSleepTimer', () => {
  let nowMs: number;
  const now = () => nowMs;

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.useFakeTimers();
    window.localStorage.clear();
    // restoreMocks doesn't clear call history the way clearMocks/resetMocks
    // would for a vi.fn() defined inside a vi.mock() factory (there's no
    // "original" for a plain vi.fn() to restore to, so it's a no-op on call
    // history here) -- explicit .mockClear() is what actually resets it.
    vi.mocked(volumeFade.canWriteVolume).mockClear().mockReturnValue(true);
    vi.mocked(volumeFade.fadeVolumeToZero)
      .mockClear()
      .mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle with no stored sleep state', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now }));
    await flushLoad();
    expect(result.current.phase).toBe('idle');
    expect(result.current.mode).toBeNull();
  });

  it('startTimer arms a deadline and persists it', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const { result } = renderHook(() => useSleepTimer(videoRef, vi.fn(), { now }));
    await flushLoad();

    act(() => result.current.startTimer(30));

    expect(result.current.phase).toBe('armed');
    expect(result.current.mode).toBe('timer');
    const stored = JSON.parse(window.localStorage.getItem(SLEEP_STORAGE_KEY) as string);
    expect(stored).toEqual({ mode: 'timer', deadlineMs: nowMs + 30 * 60_000 });
  });

  it('advances through warning, fading, and expired as wall-clock time passes', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1)); // 60_000ms out -- exactly the
    // warning threshold, so this timer starts in 'warning', not 'armed'
    // (a 1-minute timer is a test-speed convenience; the real picker never
    // offers less than 15).
    expect(result.current.phase).toBe('warning');

    nowMs += 5_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.phase).toBe('warning');

    nowMs += 41_000; // now 46s elapsed of 60s -> 14s remaining -> fading
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.phase).toBe('fading');
    expect(video.pause).not.toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();

    nowMs += 15_000; // past the deadline
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.phase).toBe('expired');
    expect(video.pause).toHaveBeenCalledOnce();
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('pauses before calling onExpire, in that order', async () => {
    const order: string[] = [];
    const video = makeVideo();
    vi.mocked(video.pause).mockImplementation(() => {
      order.push('pause');
    });
    const videoRef = { current: video };
    const onExpire = vi.fn(() => {
      order.push('onExpire');
    });
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1));
    nowMs += 61_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(order).toEqual(['pause', 'onExpire']);
  });

  it('fires the expiry sequence exactly once even if further ticks land past the deadline', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1));
    nowMs += 61_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    nowMs += 5_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(video.pause).toHaveBeenCalledOnce();
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('starts the volume fade on entering the fading phase, and restores volume at expiry', async () => {
    const video = makeVideo();
    video.volume = 0.8;
    const videoRef = { current: video };
    const { result } = renderHook(() => useSleepTimer(videoRef, vi.fn(), { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1));
    nowMs += 41_000; // 19s remaining -> fading
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(volumeFade.fadeVolumeToZero).toHaveBeenCalledOnce();
    const [passedVideo] = vi.mocked(volumeFade.fadeVolumeToZero).mock.calls[0];
    expect(passedVideo).toBe(video);

    // The mocked fade doesn't actually touch video.volume, simulating a
    // ramp already in flight; expiry must still restore it for whenever
    // the user next resumes.
    video.volume = 0.1;
    nowMs += 20_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(video.volume).toBeCloseTo(0.8);
  });

  it('skips the fade entirely when the volume cannot be written (iOS)', async () => {
    vi.mocked(volumeFade.canWriteVolume).mockReturnValue(false);
    const video = makeVideo();
    const videoRef = { current: video };
    const { result } = renderHook(() => useSleepTimer(videoRef, vi.fn(), { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1));
    nowMs += 41_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.phase).toBe('fading');
    expect(volumeFade.fadeVolumeToZero).not.toHaveBeenCalled();
  });

  it('cancel clears the deadline, restores the snapshotted volume, and never expires', async () => {
    const video = makeVideo();
    video.volume = 0.6;
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1));
    nowMs += 41_000; // into fading
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    video.volume = 0.05; // simulate the in-flight ramp having lowered it

    act(() => result.current.cancel());

    expect(result.current.phase).toBe('idle');
    expect(result.current.mode).toBeNull();
    expect(video.volume).toBeCloseTo(0.6);
    expect(window.localStorage.getItem(SLEEP_STORAGE_KEY)).toBeNull();

    nowMs += 60_000; // well past the original deadline
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onExpire).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('startEndOfEpisode sets mode without a deadline, and phase is armed', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const { result } = renderHook(() => useSleepTimer(videoRef, vi.fn(), { now }));
    await flushLoad();

    act(() => result.current.startEndOfEpisode());

    expect(result.current.mode).toBe('end-of-episode');
    expect(result.current.phase).toBe('armed');
    expect(JSON.parse(window.localStorage.getItem(SLEEP_STORAGE_KEY) as string)).toEqual({
      mode: 'end-of-episode',
    });
  });

  it('notifyEpisodeEnded expires end-of-episode mode: pause then onExpire', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now }));
    await flushLoad();

    act(() => result.current.startEndOfEpisode());
    act(() => result.current.notifyEpisodeEnded());

    expect(result.current.phase).toBe('expired');
    expect(video.pause).toHaveBeenCalledOnce();
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('notifyEpisodeEnded is a no-op outside end-of-episode mode', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now }));
    await flushLoad();

    act(() => result.current.notifyEpisodeEnded());
    expect(onExpire).not.toHaveBeenCalled();

    act(() => result.current.startTimer(30));
    act(() => result.current.notifyEpisodeEnded()); // a timer is running, not end-of-episode
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('loads a persisted timer deadline on mount', async () => {
    window.localStorage.setItem(
      SLEEP_STORAGE_KEY,
      JSON.stringify({ mode: 'timer', deadlineMs: nowMs + 90_000 }),
    );
    const video = makeVideo();
    const videoRef = { current: video };
    const { result } = renderHook(() => useSleepTimer(videoRef, vi.fn(), { now }));

    await flushLoad();
    expect(result.current.mode).toBe('timer');
    expect(result.current.phase).toBe('armed');
  });

  it('re-checks the phase immediately when the tab becomes visible again', async () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer(videoRef, onExpire, { now, tickMs: 1000 }));
    await flushLoad();

    act(() => result.current.startTimer(1));
    // Simulate a long background suspend: wall clock jumps past the
    // deadline with NO intervening timer ticks (as if setInterval itself
    // were frozen), then the tab becomes visible again.
    nowMs += 5 * 60_000;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(result.current.phase).toBe('expired');
    expect(onExpire).toHaveBeenCalledOnce();
  });
});
