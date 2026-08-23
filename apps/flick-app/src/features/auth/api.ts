// Auth actions for Flick. The session itself lives in an HttpOnly cookie set by
// the API — it is never readable or forgeable from the client. Read the current
// session with getSession() on the server, not from here.
'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { clearLegacyLocalState } from './legacyStorage';

interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
}

const NETWORK_ERROR = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';

function toResult(err: unknown, fallback: string): { success: false; error: string } {
  if (err instanceof ApiError) {
    return { success: false, error: err.message || fallback };
  }
  return { success: false, error: NETWORK_ERROR };
}

export type OtpRequestResult =
  | { success: true; ref: string; expiresIn: number }
  | { success: false; error: string };

export type OtpVerifyResult =
  | { success: true; user: AuthUser; isNewUser: boolean }
  | { success: false; error: string };

/**
 * Asks the API to send a code. The response is deliberately the same whether
 * or not an account exists, so the UI must never branch on "user found".
 */
export async function requestOtp(destination: string): Promise<OtpRequestResult> {
  try {
    const data = await apiFetch('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ destination }),
    });
    return { success: true, ref: data.ref, expiresIn: data.expiresIn };
  } catch (err) {
    return toResult(err, 'ไม่สามารถส่งรหัสได้ กรุณาลองใหม่');
  }
}

export async function verifyOtp(
  destination: string,
  ref: string,
  code: string,
): Promise<OtpVerifyResult> {
  try {
    const data = await apiFetch('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ destination, ref, code }),
    });
    clearLegacyLocalState();
    return { success: true, user: data.user, isNewUser: data.isNewUser };
  } catch (err) {
    return toResult(err, 'รหัสไม่ถูกต้องหรือหมดอายุ');
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (err) {
    // The cookie may already be gone/expired; the user still leaves the app.
    console.error('Logout failed:', err);
  }
  clearLegacyLocalState();
}
