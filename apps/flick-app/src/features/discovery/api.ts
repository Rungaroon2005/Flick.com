'use client';
import { apiFetch } from '@/lib/apiClient';
import type { FitsItem } from '@/types';

export const FITS_MINUTES_OPTIONS = [15, 30, 60, 90] as const;
export type FitsMinutes = (typeof FITS_MINUTES_OPTIONS)[number];

export async function fetchFits(maxMinutes: FitsMinutes): Promise<FitsItem[]> {
  return apiFetch(`/discovery/fits?maxMinutes=${maxMinutes}`);
}
