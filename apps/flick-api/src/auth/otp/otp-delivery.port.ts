import type { OtpChannel } from '@prisma/client';

/** DI token — an interface has no runtime value to inject against. */
export const OTP_DELIVERY_PORT = Symbol('OTP_DELIVERY_PORT');

export interface OtpDeliveryPort {
  /**
   * Delivers `code` to `destination`. The `ref` is included in the message
   * body so the recipient can match the code to the screen that asked for it.
   * Implementations MUST NOT log or persist `code`.
   *
   * Throws on delivery failure; the caller converts that to a 503.
   */
  send(
    destination: string,
    channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void>;
}
