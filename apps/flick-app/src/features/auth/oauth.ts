'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { clearLegacyLocalState } from './legacyStorage';

export type OAuthProviderId = 'google' | 'apple';

interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
}

export type OAuthVerifyResult =
  | { success: true; user: AuthUser; isNewUser: boolean }
  | { success: false; error: string; claimed?: boolean };

const NETWORK_ERROR = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';
const GENERIC_ERROR = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';

/** Which providers the API actually has credentials for. */
export async function fetchOAuthProviders(): Promise<string[]> {
  try {
    return (await apiFetch('/auth/oauth/providers')).providers;
  } catch {
    // No list means no buttons, not a broken page: OTP still works.
    return [];
  }
}

/**
 * A fresh nonce per attempt. The SDK embeds it in the signed token and the
 * server burns it once, so a captured token cannot be replayed.
 */
export async function requestNonce(provider: OAuthProviderId): Promise<string> {
  const data = await apiFetch('/auth/oauth/nonce', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
  return data.nonce;
}

export async function verifyOAuth(input: {
  provider: OAuthProviderId;
  idToken: string;
  nonce: string;
  displayName?: string;
}): Promise<OAuthVerifyResult> {
  try {
    const data = await apiFetch('/auth/oauth/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    clearLegacyLocalState();
    return { success: true, user: data.user, isNewUser: data.isNewUser };
  } catch (err) {
    if (err instanceof ApiError) {
      // 409 is the one failure with its own instruction to give (spec §6.3).
      if (err.status === 409) {
        return {
          success: false,
          error: err.message || GENERIC_ERROR,
          claimed: true,
        };
      }
      return { success: false, error: err.message || GENERIC_ERROR };
    }
    return { success: false, error: NETWORK_ERROR };
  }
}
