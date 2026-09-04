import { describe, expect, it, vi } from 'vitest';
import { canWriteVolume, fadeVolumeToZero } from './volumeFade';

/** A manually-steppable requestAnimationFrame: tests call the captured
 *  callback themselves instead of racing a real animation frame. */
function manualRaf() {
  const pending: FrameRequestCallback[] = [];
  const raf = (cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  };
  const caf = vi.fn();
  const step = (time: number) => {
    const cbs = pending.splice(0, pending.length);
    cbs.forEach((cb) => cb(time));
  };
  return { raf, caf, step };
}

describe('canWriteVolume', () => {
  it('reports true for a normal, writable video element', () => {
    const video = { volume: 1 };
    expect(canWriteVolume(video)).toBe(true);
  });

  it('reports false when the setter is a no-op (iOS Safari)', () => {
    let backing = 1;
    const video = {
      get volume() {
        return backing;
      },
      set volume(_v: number) {
        // Silently ignored, exactly like HTMLMediaElement.volume on iOS.
      },
    };
    expect(canWriteVolume(video)).toBe(false);
  });

  it('leaves the original volume unchanged either way', () => {
    const writable = { volume: 0.73 };
    canWriteVolume(writable);
    expect(writable.volume).toBeCloseTo(0.73);
  });
});

describe('fadeVolumeToZero', () => {
  it('ramps volume from its starting value down to 0 over the given duration', () => {
    const video = { volume: 0.8 };
    let now = 0;
    const { raf, step } = manualRaf();
    const onDone = vi.fn();

    fadeVolumeToZero(video, 1000, onDone, { raf, now: () => now });

    now = 500; // halfway
    step(now);
    expect(video.volume).toBeCloseTo(0.4, 1);
    expect(onDone).not.toHaveBeenCalled();

    now = 1000; // done
    step(now);
    expect(video.volume).toBe(0);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('calls onDone immediately without animating when already silent', () => {
    const video = { volume: 0 };
    const onDone = vi.fn();
    const { raf } = manualRaf();
    fadeVolumeToZero(video, 1000, onDone, { raf, now: () => 0 });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('the returned cancel function stops the ramp and skips onDone', () => {
    const video = { volume: 1 };
    let now = 0;
    const { raf, caf, step } = manualRaf();
    const onDone = vi.fn();

    const cancel = fadeVolumeToZero(video, 1000, onDone, { raf, caf, now: () => now });
    now = 200;
    step(now);
    const volumeAtCancel = video.volume;

    cancel();
    now = 1000;
    step(now); // if the ramp were still running, this would reach 0 + call onDone

    expect(video.volume).toBe(volumeAtCancel);
    expect(onDone).not.toHaveBeenCalled();
  });
});
