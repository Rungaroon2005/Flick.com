/** The minimal surface this module needs from HTMLMediaElement. */
export interface VolumeControllable {
  volume: number;
}

/**
 * Feature-detects a writable volume by probing with a value guaranteed to
 * differ from the current one, then restoring it -- immediately, in the
 * same tick, before the real fade starts, so there is no audible blip.
 * A same-value write can't distinguish read-only from writable, which is
 * why this doesn't just try setting `video.volume = video.volume`.
 *
 * iOS Safari makes HTMLMediaElement.volume read-only; the assignment
 * silently no-ops rather than throwing, so this is the only way to find out.
 */
export function canWriteVolume(video: VolumeControllable): boolean {
  const original = video.volume;
  const probe = original > 0.5 ? original - 0.1 : original + 0.1;
  video.volume = probe;
  const changed = Math.abs(video.volume - probe) < 0.001;
  video.volume = original;
  return changed;
}

export interface VolumeFadeControls {
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

/**
 * Ramps `video.volume` linearly to 0 over `durationMs`, driven by
 * requestAnimationFrame rather than an interval or CSS transition: rAF
 * pauses with a backgrounded tab, and the wall-clock check in
 * useSleepTimer corrects the phase on resume anyway, so there is nothing
 * to reconcile when frames are skipped.
 *
 * `raf`/`caf`/`now` are injectable so tests drive the ramp with a manual
 * clock instead of racing real animation frames or fighting fake-timer
 * integration with rAF.
 */
export function fadeVolumeToZero(
  video: VolumeControllable,
  durationMs: number,
  onDone: () => void,
  controls: VolumeFadeControls = {},
): () => void {
  const raf = controls.raf ?? requestAnimationFrame;
  const caf = controls.caf ?? cancelAnimationFrame;
  const now = controls.now ?? (() => performance.now());

  const startVolume = video.volume;
  if (startVolume <= 0) {
    onDone();
    return () => {};
  }

  const startTime = now();
  let rafId: number;
  let cancelled = false;

  const step = () => {
    if (cancelled) return;
    const elapsed = now() - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    video.volume = startVolume * (1 - progress);
    if (progress >= 1) {
      onDone();
    } else {
      rafId = raf(step);
    }
  };
  rafId = raf(step);

  return () => {
    cancelled = true;
    caf(rafId);
  };
}
