import { OtpChannel } from '@prisma/client';
import { RoutingOtpDeliveryAdapter } from './routing-delivery.adapter';

describe('RoutingOtpDeliveryAdapter', () => {
  // Plain `{ send: jest.Mock }` (not `jest.Mocked<OtpDeliveryPort>`) so
  // eslint doesn't see `sms.send` as an unbound interface method reference —
  // same pattern as otp.service.spec.ts.
  function makeStub(): { send: jest.Mock } {
    return { send: jest.fn().mockResolvedValue(undefined) };
  }

  it('routes SMS channel sends to the SMS adapter only', async () => {
    const sms = makeStub();
    const email = makeStub();
    const adapter = new RoutingOtpDeliveryAdapter(sms, email);

    await adapter.send('+66811111111', OtpChannel.SMS, '123456', 'REF1');

    expect(sms.send).toHaveBeenCalledWith(
      '+66811111111',
      OtpChannel.SMS,
      '123456',
      'REF1',
    );
    expect(email.send).not.toHaveBeenCalled();
  });

  it('routes EMAIL channel sends to the email adapter only', async () => {
    const sms = makeStub();
    const email = makeStub();
    const adapter = new RoutingOtpDeliveryAdapter(sms, email);

    await adapter.send('user@example.com', OtpChannel.EMAIL, '654321', 'REF2');

    expect(email.send).toHaveBeenCalledWith(
      'user@example.com',
      OtpChannel.EMAIL,
      '654321',
      'REF2',
    );
    expect(sms.send).not.toHaveBeenCalled();
  });
});
