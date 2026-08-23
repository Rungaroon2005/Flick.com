import type { ConfigService } from '@nestjs/config';
import { createOtpDeliveryPort } from './otp.module';
import { ConsoleOtpDeliveryAdapter } from './adapters/console-delivery.adapter';
import { RoutingOtpDeliveryAdapter } from './adapters/routing-delivery.adapter';

/**
 * Exercises the delivery-adapter selection factory directly. The factory is
 * exported from otp.module.ts specifically so this doesn't need a full Nest
 * TestingModule bootstrap.
 */
describe('createOtpDeliveryPort', () => {
  function stubConfig(values: Record<string, string>): ConfigService {
    return {
      get: (key: string, fallback?: string) => values[key] ?? fallback,
    } as unknown as ConfigService;
  }

  it('selects the console adapter when OTP_DELIVERY is unset', () => {
    const port = createOtpDeliveryPort(stubConfig({}));
    expect(port).toBeInstanceOf(ConsoleOtpDeliveryAdapter);
  });

  it('selects the console adapter when OTP_DELIVERY=console', () => {
    const port = createOtpDeliveryPort(stubConfig({ OTP_DELIVERY: 'console' }));
    expect(port).toBeInstanceOf(ConsoleOtpDeliveryAdapter);
  });

  it('selects the routing adapter when OTP_DELIVERY=live', () => {
    const port = createOtpDeliveryPort(stubConfig({ OTP_DELIVERY: 'live' }));
    expect(port).toBeInstanceOf(RoutingOtpDeliveryAdapter);
    expect(port).not.toBeInstanceOf(ConsoleOtpDeliveryAdapter);
  });
});
