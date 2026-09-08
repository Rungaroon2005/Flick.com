import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyOAuth } from './oauth';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.restoreAllMocks());

describe('verifyOAuth', () => {
  const input = { provider: 'google' as const, idToken: 't', nonce: 'n' };

  it('reports the signed-in user on success', async () => {
    respond(200, {
      success: true,
      user: { id: 'u1', email: 'a@example.com', phone: null, displayName: 'A' },
      isNewUser: false,
    });

    await expect(verifyOAuth(input)).resolves.toMatchObject({
      success: true,
      user: { id: 'u1' },
    });
  });

  it('flags a 409 as the claimed-email case, not a generic failure', async () => {
    // The login screen renders a specific instruction for this one.
    respond(409, { message: 'มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว' });

    await expect(verifyOAuth(input)).resolves.toMatchObject({
      success: false,
      claimed: true,
    });
  });

  it('reports other failures without the claimed flag', async () => {
    respond(400, { message: 'Invalid or expired login request' });

    const result = await verifyOAuth(input);
    expect(result).toMatchObject({ success: false });
    expect((result as { claimed?: boolean }).claimed).toBeUndefined();
  });
});
