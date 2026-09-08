import { Injectable, Logger } from '@nestjs/common';
import type { OtpChannel } from '@prisma/client';
import { maskDestination } from '../destination';
import type { OtpDeliveryPort } from '../otp-delivery.port';

/**
 * Development and CI delivery. Prints the code to the server log and keeps the
 * most recent code per destination in memory so the e2e suite can complete a
 * real request→verify round-trip with no SMS vendor and no spend.
 *
 * Selected only when OTP_DELIVERY=console. `validateEnv` refuses that
 * combination when NODE_ENV=production, because this adapter delivers nothing
 * and would silently lock every user out.
 */
@Injectable()
export class ConsoleOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger('OtpDelivery');
  private readonly lastCodes = new Map<string, string>();

  send(
    destination: string,
    channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    this.lastCodes.set(destination, code);
    // The code appears here deliberately — that is this adapter's whole job in
    // local development. The destination is still masked, because dev logs get
    // pasted into issues.
    this.logger.log(
      `[${channel}] ${maskDestination(destination)} ref=${ref} code=${code}`,
    );
    return Promise.resolve();
  }

  /** Test/dev only. Returns the last code sent to `destination`, if any. */
  lastCodeFor(destination: string): string | undefined {
    return this.lastCodes.get(destination);
  }
}
