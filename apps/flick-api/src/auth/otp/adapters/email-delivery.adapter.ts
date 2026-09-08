import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannel } from '@prisma/client';
import { maskDestination } from '../destination';
import type { OtpDeliveryPort } from '../otp-delivery.port';

const SEND_TIMEOUT_MS = 8000;

/**
 * Transactional email over a generic HTTP JSON API. Only ever called for an
 * address already verified on an account — OtpService enforces that; this
 * adapter must not re-decide it.
 */
@Injectable()
export class EmailOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger('OtpDelivery');

  constructor(private readonly config: ConfigService) {}

  async send(
    destination: string,
    _channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    const endpoint = this.config.getOrThrow<string>('OTP_EMAIL_ENDPOINT');
    const apiKey = this.config.getOrThrow<string>('OTP_EMAIL_API_KEY');
    const from = this.config.get<string>(
      'OTP_EMAIL_FROM',
      'no-reply@flick.co.th',
    );

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: destination,
        from,
        subject: `รหัสยืนยัน Flick (${ref})`,
        text: `รหัสยืนยันของคุณคือ ${code}\nรหัสอ้างอิง: ${ref}\nรหัสนี้หมดอายุใน 5 นาที`,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      this.logger.error(
        `Email vendor rejected send to ${maskDestination(destination)} (HTTP ${response.status})`,
      );
      throw new Error(`Email delivery failed with HTTP ${response.status}`);
    }
  }
}
