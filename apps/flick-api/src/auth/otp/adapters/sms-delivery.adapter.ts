import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannel } from '@prisma/client';
import { maskDestination } from '../destination';
import type { OtpDeliveryPort } from '../otp-delivery.port';

/** A stalled vendor must not hold the request (and its DB connection) open. */
const SEND_TIMEOUT_MS = 8000;

/**
 * Generic HTTP JSON SMS vendor. The specific provider is still an open
 * decision (see the spec); this adapter is deliberately the only file that
 * knows the wire format, so switching vendors is a one-file change.
 */
@Injectable()
export class HttpOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger('OtpDelivery');

  constructor(private readonly config: ConfigService) {}

  async send(
    destination: string,
    _channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    const endpoint = this.config.getOrThrow<string>('OTP_SMS_ENDPOINT');
    const apiKey = this.config.getOrThrow<string>('OTP_SMS_API_KEY');
    const sender = this.config.get<string>('OTP_SMS_SENDER', 'Flick');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: destination,
        from: sender,
        message: `รหัสยืนยัน Flick: ${code} (อ้างอิง ${ref}) หมดอายุใน 5 นาที`,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Neither the code nor the full number appears here: this string ends up
      // in logs and in an exception trace.
      this.logger.error(
        `SMS vendor rejected send to ${maskDestination(destination)} (HTTP ${response.status})`,
      );
      throw new Error(`SMS delivery failed with HTTP ${response.status}`);
    }
  }
}
