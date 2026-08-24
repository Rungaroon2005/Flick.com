import { OtpChannel } from '@prisma/client';
import type { OtpDeliveryPort } from '../otp-delivery.port';

/**
 * OtpService depends on ONE delivery port but supports two channels. This
 * composite keeps that seam in one place instead of teaching the service
 * about vendors.
 */
export class RoutingOtpDeliveryAdapter implements OtpDeliveryPort {
  constructor(
    private readonly sms: OtpDeliveryPort,
    private readonly email: OtpDeliveryPort,
  ) {}

  send(
    destination: string,
    channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    const target = channel === OtpChannel.EMAIL ? this.email : this.sms;
    return target.send(destination, channel, code, ref);
  }
}
