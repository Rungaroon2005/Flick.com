import { describe, expect, it } from 'vitest';
import { FADE_START_MS, WARNING_START_MS, sleepPhase } from './sleepPhase';

const DEADLINE = 1_000_000;

describe('sleepPhase', () => {
  it('is idle when no deadline is set', () => {
    expect(sleepPhase(DEADLINE, null)).toBe('idle');
  });

  it('is armed arbitrarily far before the deadline, once one is set', () => {
    // 'idle' means no deadline at all, not "far from it" -- a timer set 30
    // minutes out is armed the instant it's set, same as one set 61 seconds
    // out.
    expect(sleepPhase(DEADLINE - 30 * 60_000, DEADLINE)).toBe('armed');
  });

  it('is armed right up to the warning threshold', () => {
    expect(sleepPhase(DEADLINE - WARNING_START_MS - 1, DEADLINE)).toBe('armed');
  });

  it('enters warning exactly at T-60s', () => {
    expect(sleepPhase(DEADLINE - WARNING_START_MS, DEADLINE)).toBe('warning');
  });

  it('stays in warning right up to the fade threshold', () => {
    expect(sleepPhase(DEADLINE - FADE_START_MS - 1, DEADLINE)).toBe('warning');
  });

  it('enters fading exactly at T-20s', () => {
    expect(sleepPhase(DEADLINE - FADE_START_MS, DEADLINE)).toBe('fading');
  });

  it('stays fading right up to the deadline', () => {
    expect(sleepPhase(DEADLINE - 1, DEADLINE)).toBe('fading');
  });

  it('expires exactly at the deadline', () => {
    expect(sleepPhase(DEADLINE, DEADLINE)).toBe('expired');
  });

  it('stays expired arbitrarily far past the deadline', () => {
    // Covers the backgrounded-tab case: the timer was frozen and the
    // wall-clock check runs long after the deadline passed.
    expect(sleepPhase(DEADLINE + 10 * 60_000, DEADLINE)).toBe('expired');
  });
});
