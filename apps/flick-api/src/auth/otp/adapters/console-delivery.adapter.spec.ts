import { OtpChannel } from '@prisma/client';
import { ConsoleOtpDeliveryAdapter } from './console-delivery.adapter';

describe('ConsoleOtpDeliveryAdapter', () => {
  let adapter: ConsoleOtpDeliveryAdapter;

  beforeEach(() => {
    adapter = new ConsoleOtpDeliveryAdapter();
  });

  it('makes the delivered code retrievable per destination', async () => {
    await adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C');
    await adapter.send('+66899999999', OtpChannel.SMS, '654321', 'XY9Z');

    expect(adapter.lastCodeFor('+66812345678')).toBe('123456');
    expect(adapter.lastCodeFor('+66899999999')).toBe('654321');
    expect(adapter.lastCodeFor('+66800000000')).toBeUndefined();
  });

  it('keeps only the most recent code for a destination', async () => {
    await adapter.send('+66812345678', OtpChannel.SMS, '111111', 'AAAA');
    await adapter.send('+66812345678', OtpChannel.SMS, '222222', 'BBBB');
    expect(adapter.lastCodeFor('+66812345678')).toBe('222222');
  });

  it('never writes the unmasked destination to the log', async () => {
    const logs: string[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((msg: unknown) => void logs.push(String(msg)));

    await adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C');

    expect(logs.join('\n')).not.toContain('+66812345678');
  });
});
