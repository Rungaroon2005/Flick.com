'use client';
import { apiFetch } from '@/lib/apiClient';
import type { FitsItem } from '@/types';

export const FITS_MINUTES_OPTIONS = [15, 30, 60, 90] as const;
export type FitsMinutes = (typeof FITS_MINUTES_OPTIONS)[number];

// A hardcoded, stable taxonomy -- mirrors DiscoverClient's genre list.
// There is no admin UI to create moods yet (seed.ts only, for this phase),
// so this list is the source of truth on the frontend too.
export const MOOD_OPTIONS = [
  { slug: 'lonely', name: 'เหงา', emoji: '🌙' },
  { slug: 'stressed', name: 'เครียด', emoji: '😣' },
  { slug: 'laugh', name: 'อยากหัวเราะ', emoji: '😂' },
  { slug: 'cry', name: 'อยากร้องไห้', emoji: '😢' },
  { slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' },
  { slug: 'inspired', name: 'อยากได้แรงบันดาลใจ', emoji: '✨' },
] as const;
export type MoodSlug = (typeof MOOD_OPTIONS)[number]['slug'];

export async function fetchFits(
  maxMinutes: FitsMinutes,
  mood?: MoodSlug,
): Promise<FitsItem[]> {
  if (mood) {
    return apiFetch(`/discovery/fits?maxMinutes=${maxMinutes}&mood=${mood}`);
  }
  return apiFetch(`/discovery/fits?maxMinutes=${maxMinutes}`);
}
