import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/apiClient';
import { usePlaybackAuthorization } from './usePlaybackAuthorization';

vi.mock('@/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
  apiFetch: vi.fn(),
}));

describe('usePlaybackAuthorization', () => {
  it('uses server-provided authorization without a duplicate mount request', () => {
    const router = { push: vi.fn() } as never;
    const { result } = renderHook(() =>
      usePlaybackAuthorization('episode-1', router, true, {
        allowed: true,
        reason: 'free',
        videoUrl: '/videos/episode-1.m4v',
      }),
    );

    expect(result.current.videoUrl).toBe('/videos/episode-1.m4v');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
