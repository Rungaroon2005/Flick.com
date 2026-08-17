// Auth actions for Flick. The session itself lives in an HttpOnly cookie set by
// the API — it is never readable or forgeable from the client. Read the current
// session with getSession() on the server, not from here.
'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { clearLegacyLocalState } from './legacyStorage';

interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
}

interface AuthResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

const NETWORK_ERROR = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';

function toResult(err: unknown, fallback: string): AuthResult {
  if (err instanceof ApiError) {
    return { success: false, error: err.message || fallback };
  }
  return { success: false, error: NETWORK_ERROR };
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResult> {
  try {
    const data = await apiFetch(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    clearLegacyLocalState();
    return { success: true, user: data.user };
  } catch (err) {
    return toResult(err, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
}

export async function register(data: {
  displayName: string;
  email: string;
  phone?: string;
  password: string;
}): Promise<AuthResult> {
  try {
    const result = await apiFetch(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          displayName: data.displayName,
          email: data.email,
          phone: data.phone || undefined,
          password: data.password,
        }),
      },
    );
    clearLegacyLocalState();
    return { success: true, user: result.user };
  } catch (err) {
    return toResult(err, 'การสมัครสมาชิกผิดพลาด');
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
