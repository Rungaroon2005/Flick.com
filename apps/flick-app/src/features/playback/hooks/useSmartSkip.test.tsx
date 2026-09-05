import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findActiveMarker, useSmartSkip } from './useSmartSkip';

const MARKERS = [
  { kind: 'INTRO', startSeconds: 0, endSeconds: 30 },
  { kind: 'CREDITS', startSeconds: 560, endSeconds: 600 },
];

describe('findActiveMarker', () => {
  it('finds the marker containing currentTime', () => {
    expect(findActiveMarker(MARKERS, 15)).toBe(MARKERS[0]);
  });

  it('is active starting exactly at startSeconds (inclusive)', () => {
    expect(findActiveMarker(MARKERS, 0)).toBe(MARKERS[0]);
  });

  it('is no longer active exactly at endSeconds (exclusive)', () => {
    expect(findActiveMarker(MARKERS, 30)).toBeNull();
  });

  it('returns null between markers', () => {
    expect(findActiveMarker(MARKERS, 300)).toBeNull();
  });

  it('returns null for an empty marker list', () => {
    expect(findActiveMarker([], 15)).toBeNull();
  });
});

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  return video;
}

describe('useSmartSkip', () => {
  it('reports no active marker outside any range', () => {
    const videoRef = { current: makeVideo() };
    const { result } = renderHook(() => useSmartSkip(videoRef, MARKERS, 300, false));
    expect(result.current.activeMarker).toBeNull();
  });

  it('reports the active marker while inside its range', () => {
    const videoRef = { current: makeVideo() };
    const { result } = renderHook(() => useSmartSkip(videoRef, MARKERS, 15, false));
    expect(result.current.activeMarker).toEqual(MARKERS[0]);
  });

  it('skip() jumps the video to the active marker\'s endSeconds', () => {
    const video = makeVideo();
    const videoRef = { current: video };
    const { result } = renderHook(() => useSmartSkip(videoRef, MARKERS, 15, false));
    act(() => result.current.skip());
    expect(video.currentTime).toBe(30);
  });

  it('skip() is a no-op when there is no active marker', () => {
    const video = makeVideo();
    video.currentTime = 300;
    const videoRef = { current: video };
    const { result } = renderHook(() => useSmartSkip(videoRef, MARKERS, 300, false));
    act(() => result.current.skip());
    expect(video.currentTime).toBe(300);
  });

  it('does not auto-skip when autoSkip is off', () => {
    const video = makeVideo();
    video.currentTime = 5;
    const videoRef = { current: video };
    renderHook(() => useSmartSkip(videoRef, MARKERS, 5, false));
    expect(video.currentTime).toBe(5);
  });

  it('auto-skips to endSeconds on entering a marker when autoSkip is on', () => {
    const video = makeVideo();
    video.currentTime = 5;
    const videoRef = { current: video };
    renderHook(() => useSmartSkip(videoRef, MARKERS, 5, true));
    expect(video.currentTime).toBe(30);
  });

  it('auto-skips only once per marker entry, not on every re-render while still inside it', () => {
    const video = makeVideo();
    const setTimeSpy = vi.spyOn(video, 'currentTime', 'set');
    const videoRef = { current: video };
    const { rerender } = renderHook(
      ({ t }) => useSmartSkip(videoRef, MARKERS, t, true),
      { initialProps: { t: 5 } },
    );
    expect(setTimeSpy).toHaveBeenCalledTimes(1);

    // Still inside the same marker on the next tick -- must not re-jump.
    rerender({ t: 6 });
    expect(setTimeSpy).toHaveBeenCalledTimes(1);
  });

  it('with zero markers: no active marker ever, and nothing throws with autoSkip on', () => {
    const video = makeVideo();
    const videoRef = { current: video };
    expect(() => {
      const { result, rerender } = renderHook(
        ({ t }) => useSmartSkip(videoRef, [], t, true),
        { initialProps: { t: 0 } },
      );
      expect(result.current.activeMarker).toBeNull();
      act(() => result.current.skip());
      rerender({ t: 500 });
      expect(result.current.activeMarker).toBeNull();
    }).not.toThrow();
    expect(video.currentTime).toBe(0); // skip() on no marker never touched it
  });

  it('re-arms after leaving a marker, so a later marker still auto-skips', () => {
    const video = makeVideo();
    const setTimeSpy = vi.spyOn(video, 'currentTime', 'set');
    const videoRef = { current: video };
    const { rerender } = renderHook(
      ({ t }) => useSmartSkip(videoRef, MARKERS, t, true),
      { initialProps: { t: 5 } }, // inside INTRO -> jumps to 30
    );
    expect(setTimeSpy).toHaveBeenCalledTimes(1);

    rerender({ t: 300 }); // between markers
    rerender({ t: 570 }); // inside CREDITS -> should jump again
    expect(setTimeSpy).toHaveBeenCalledTimes(2);
    expect(setTimeSpy).toHaveBeenLastCalledWith(600);
  });
});
