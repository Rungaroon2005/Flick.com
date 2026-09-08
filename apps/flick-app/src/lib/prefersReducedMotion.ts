/**
 * The one motion check globals.css's blanket @media rule can't make for
 * us: a JS-driven animation (the sleep timer's volume ramp) isn't a CSS
 * transition, so nothing there collapses it automatically.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
