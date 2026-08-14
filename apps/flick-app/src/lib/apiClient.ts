// Single entry point for browser -> API calls.
// Centralises the two things every hand-rolled fetch got wrong:
//   1. credentials: 'include'  — without it the HttpOnly access_token cookie is never sent
//   2. a consistent error shape — callers get ApiError { status, message } instead of guessing
import API_BASE_URL from '@/lib/api';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่';

/** Turns a Response into T, or throws ApiError carrying the API's own message. */
export async function unwrapResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body: { message?: string | string[] } = await res
      .json()
      .catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new ApiError(res.status, msg ?? DEFAULT_ERROR);
  }
  if (res.status === 204) return undefined as T;
  // A 200 can still carry no body: Nest replies to a controller that returned
  // null/undefined with an empty body (Express `res.send()`), NOT the literal
  // `null`. GET /subscriptions/me does exactly that for a user with no
  // subscription — the common case — so res.json() would throw a SyntaxError
  // that is not an ApiError and would escape every caller's error handling.
  // "No body" therefore means "no value", not "malformed response".
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  return unwrapResponse<T>(res);
}
