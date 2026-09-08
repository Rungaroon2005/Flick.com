import { describe, expect, it } from 'vitest';
import { estimateFinishTime, formatClockTime, formatDurationThai } from './finishTime';

const NOW = new Date('2026-09-05T20:15:00.000Z');

describe('estimateFinishTime', () => {
  it('with zero markers, finishes exactly remainingSeconds later at 1x', () => {
    const { finishesAt, savedSeconds } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 3600, // 1 hour
      skippableSeconds: 0,
      autoSkip: true, // on, but nothing to skip
      playbackRate: 1,
    });
    expect(finishesAt).toEqual(new Date('2026-09-05T21:15:00.000Z'));
    expect(savedSeconds).toBe(0);
  });

  it('does not subtract skippable time when autoSkip is off', () => {
    const { finishesAt, savedSeconds } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 3600,
      skippableSeconds: 240, // 4 minutes of markers exist...
      autoSkip: false, // ...but won't actually be skipped
      playbackRate: 1,
    });
    expect(finishesAt).toEqual(new Date('2026-09-05T21:15:00.000Z'));
    expect(savedSeconds).toBe(0);
  });

  it('subtracts skippable time when autoSkip is on, and reports the saving', () => {
    const { finishesAt, savedSeconds } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 3600,
      skippableSeconds: 240,
      autoSkip: true,
      playbackRate: 1,
    });
    expect(finishesAt).toEqual(new Date('2026-09-05T21:11:00.000Z')); // 4 min sooner
    expect(savedSeconds).toBe(240);
  });

  it('scales wall-clock time by a playbackRate other than 1x', () => {
    const { finishesAt } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 3600,
      skippableSeconds: 0,
      autoSkip: false,
      playbackRate: 1.5,
    });
    // 3600 content-seconds at 1.5x take 2400 wall-clock seconds (40 min).
    expect(finishesAt).toEqual(new Date('2026-09-05T20:55:00.000Z'));
  });

  it('the saved-time figure is also scaled by playbackRate', () => {
    const { savedSeconds } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 3600,
      skippableSeconds: 240,
      autoSkip: true,
      playbackRate: 2,
    });
    expect(savedSeconds).toBe(120); // 4 min of content is 2 min of wall clock at 2x
  });

  it('reflects progress already made -- remainingSeconds is what is left, not the total', () => {
    // A 60-minute episode with 45 minutes already watched has 15 left.
    const { finishesAt } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 15 * 60,
      skippableSeconds: 0,
      autoSkip: false,
      playbackRate: 1,
    });
    expect(finishesAt).toEqual(new Date('2026-09-05T20:30:00.000Z'));
  });

  it('never reports negative watch time if skippableSeconds exceeds what remains', () => {
    // Can happen once the user has already played past most markers --
    // remainingSeconds shrinks below skippableSeconds computed for the
    // whole episode.
    const { finishesAt, savedSeconds } = estimateFinishTime({
      now: NOW,
      remainingSeconds: 100,
      skippableSeconds: 240,
      autoSkip: true,
      playbackRate: 1,
    });
    expect(finishesAt).toEqual(NOW); // clamped to "finishes now", not in the past
    expect(savedSeconds).toBe(100); // can't save more than what was left to watch
  });

  it('recomputes a later finish time when reopened after a pause -- never memoized against a stale now', () => {
    // Simulates the player overlay: closed (chrome hidden) during a pause,
    // then reopened minutes later. remainingSeconds is unchanged (the
    // video didn't advance while paused); only wall-clock time passed.
    const atClose = estimateFinishTime({
      now: NOW,
      remainingSeconds: 600,
      skippableSeconds: 0,
      autoSkip: false,
      playbackRate: 1,
    });
    const tenMinutesLater = new Date(NOW.getTime() + 10 * 60_000);
    const atReopen = estimateFinishTime({
      now: tenMinutesLater,
      remainingSeconds: 600, // still 600 -- nothing played while paused
      skippableSeconds: 0,
      autoSkip: false,
      playbackRate: 1,
    });
    expect(atReopen.finishesAt.getTime()).toBeGreaterThan(atClose.finishesAt.getTime());
    expect(atReopen.finishesAt).toEqual(new Date(tenMinutesLater.getTime() + 600_000));
  });
});

describe('formatDurationThai', () => {
  it('renders hours and minutes together', () => {
    expect(formatDurationThai(107)).toBe('1 ชม 47 นาที');
  });

  it('omits minutes when the duration is a whole number of hours', () => {
    expect(formatDurationThai(120)).toBe('2 ชม');
  });

  it('omits hours when under 60 minutes', () => {
    expect(formatDurationThai(45)).toBe('45 นาที');
  });

  it('renders zero as a duration, not an empty string', () => {
    expect(formatDurationThai(0)).toBe('0 นาที');
  });
});

describe('formatClockTime', () => {
  it('renders 24-hour, zero-padded local time', () => {
    const date = new Date(2026, 8, 5, 22, 7);
    expect(formatClockTime(date)).toBe('22:07');
  });

  it('zero-pads single-digit hours and minutes', () => {
    const date = new Date(2026, 8, 5, 8, 5);
    expect(formatClockTime(date)).toBe('08:05');
  });
});
