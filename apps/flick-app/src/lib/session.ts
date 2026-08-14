// SERVER-ONLY. Never import from a Client Component.
// A Server Component has no browser to attach the HttpOnly access_token cookie
// for it, so the incoming request's cookie header is forwarded explicitly.
import { cookies } from 'next/headers';
import API_BASE_URL from '@/lib/api';
import { ApiError, unwrapResponse } from '@/lib/apiClient';
import type { AuthenticatedUser } from '@/types';

/** Server-side twin of apiFetch. Forwards the caller's cookies; never cached. */
export async function apiFetchServer<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const cookieHeader = (await cookies()).toString(); // cookies() is async in Next 16
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // An authenticated response must never be cached — it is one user's data.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      cookie: cookieHeader,
      ...init.headers,
    },
  });
  return unwrapResponse<T>(res);
}

/**
 * The authoritative "is this request logged in?" check: the API validates the
 * JWT in the HttpOnly cookie. Returns null when it does not (401), so callers
 * fail closed. Network/API outages still throw — a broken API is an error, not
 * a logged-out user.
 */
export async function getSession(): Promise<AuthenticatedUser | null> {
  try {
    return await apiFetchServer<AuthenticatedUser>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
