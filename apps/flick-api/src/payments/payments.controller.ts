import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('checkout')
  createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    // userId comes from the validated JWT, never from the body.
    return this.paymentsService.createCheckout(user.id, dto);
  }

  /**
   * Server-to-server callback from the gateway. @Public because a gateway has
   * no session; @SkipThrottle because throttling a gateway's retries turns a
   * transient blip into lost payments. Authentication here IS the signature.
   */
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('webhook/:gateway')
  webhook(
    @Param('gateway') gateway: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!req.rawBody) {
      // Only possible if main.ts's rawBody option was removed.
      throw new BadRequestException('Raw body unavailable');
    }
    return this.paymentsService.handleWebhook(
      gateway,
      req.rawBody,
      req.headers,
    );
  }
}
