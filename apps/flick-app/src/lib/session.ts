// SERVER-ONLY. Never import from a Client Component.
// A Server Component has no browser to attach the HttpOnly access_token cookie
// for it, so the incoming request's cookie header is forwarded explicitly.
import { cookies } from 'next/headers';
import API_BASE_URL from '@/lib/api';
import { ApiError, unwrapResponse } from '@/lib/apiClient';
import type { AuthenticatedUser } from '@/types';
import { decodeApiResponse, type ApiPath, type ApiResponse } from '@/types/api';

/** Server-side twin of apiFetch. Forwards the caller's cookies; never cached. */
export async function apiFetchServer<Path extends ApiPath>(
  path: Path,
  init: RequestInit = {},
): Promise<ApiResponse<Path>> {
  const cookieHeader = (await cookies()).toString(); // cookies() is async in Next 16
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // An authenticated response must never be cached — it is one user's data.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      // Last, deliberately: a caller must never be able to override the real
      // session cookie by passing its own `headers.cookie`.
      cookie: cookieHeader,
    },
  });
  const value = await unwrapResponse(res);
  try {
    return decodeApiResponse(path, value);
  } catch {
    throw new ApiError(502, 'เซิร์ฟเวอร์ส่งข้อมูลที่ไม่ตรงตามสัญญา API');
  }
}

/**
 * The authoritative "is this request logged in?" check: the API validates the
 * JWT in the HttpOnly cookie. Returns null when it does not (401), so callers
 * fail closed. Network/API outages still throw — a broken API is an error, not
 * a logged-out user.
 */
export async function getSession(): Promise<AuthenticatedUser | null> {
  try {
    return await apiFetchServer('/auth/me');
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
