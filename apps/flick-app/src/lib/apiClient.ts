// Single entry point for browser -> API calls.
// Centralises the two things every hand-rolled fetch got wrong:
//   1. credentials: 'include'  — without it the HttpOnly access_token cookie is never sent
//   2. a consistent error shape — callers get ApiError { status, message } instead of guessing
import API_BASE_URL from '@/lib/api';
import { decodeApiResponse, type ApiPath, type ApiResponse } from '@/types/api';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่';

/** Turns a Response into unknown JSON; endpoint contracts decode it afterwards. */
export async function unwrapResponse(res: Response): Promise<unknown> {
  if (!res.ok) {
    const body: { message?: string | string[] } = await res
      .json()
      .catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new ApiError(res.status, msg ?? DEFAULT_ERROR);
  }
  if (res.status === 204) return undefined;
  // A 200 can still carry no body: Nest replies to a controller that returned
  // null/undefined with an empty body (Express `res.send()`), NOT the literal
  // `null`. GET /subscriptions/me does exactly that for a user with no
  // subscription — the common case — so res.json() would throw a SyntaxError
  // that is not an ApiError and would escape every caller's error handling.
  // "No body" therefore means "no value", not "malformed response".
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(502, 'เซิร์ฟเวอร์ส่งข้อมูลที่ไม่ถูกต้อง');
  }
}

export async function apiFetch<Path extends ApiPath>(
  path: Path,
  init: RequestInit = {},
): Promise<ApiResponse<Path>> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const value = await unwrapResponse(res);
  try {
    return decodeApiResponse(path, value);
  } catch {
    throw new ApiError(502, 'เซิร์ฟเวอร์ส่งข้อมูลที่ไม่ตรงตามสัญญา API');
  }
}
