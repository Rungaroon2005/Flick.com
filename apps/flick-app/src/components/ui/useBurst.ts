'use client';

import { useEffect, useRef, useState } from 'react';

/** Matches --animate-reaction-ring's 550ms in globals.css. Kept in one place
 *  so a second consumer cannot drift out of sync with the keyframe. */
const BURST_MS = 550;

/**
 * One-shot burst state for the app's single flourish (reaction-pop +
 * reaction-ring). True for the length of the animation on the transition
 * INTO `active`, then false again.
 *
 * Deliberately silent on the initial render and on the transition out: a
 * page that loads with something already liked should not celebrate, and
 * un-liking is not an achievement.
 */
export function useBurst(active: boolean): boolean {
  const [burst, setBurst] = useState(false);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      setBurst(true);
      const timer = window.setTimeout(() => setBurst(false), BURST_MS);
      wasActive.current = active;
      return () => window.clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active]);

  return burst;
}
