import { OtpChannel } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { HttpOtpDeliveryAdapter } from './sms-delivery.adapter';

describe('HttpOtpDeliveryAdapter', () => {
  const config = {
    getOrThrow: (key: string) =>
      ({
        OTP_SMS_ENDPOINT: 'https://sms.example/send',
        OTP_SMS_API_KEY: 'secret-key',
      })[key] as string,
    get: (key: string, fallback?: string) =>
      key === 'OTP_SMS_SENDER' ? 'Flick' : fallback,
  } as unknown as ConfigService;

  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('posts the code to the configured endpoint', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const adapter = new HttpOtpDeliveryAdapter(config);

    await adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sms.example/send');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.to).toBe('+66812345678');
    expect(body.message).toContain('123456');
    expect(body.message).toContain('AB2C');
  });

  it('throws when the vendor rejects the send', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));
    const adapter = new HttpOtpDeliveryAdapter(config);

    await expect(
      adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C'),
    ).rejects.toThrow();
  });

  it('gives up rather than hanging when the vendor stalls', async () => {
    fetchSpy.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const adapter = new HttpOtpDeliveryAdapter(config);

    await expect(
      adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C'),
    ).rejects.toThrow();
  }, 15_000);

  it('never puts the code or the full destination in an error message', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));
    const adapter = new HttpOtpDeliveryAdapter(config);

    await expect(
      adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C'),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('123456') as unknown as string,
      }),
    );
  });
});
