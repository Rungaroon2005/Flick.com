import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_GATEWAY_PORT } from './payment-gateway.port';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PaymentsService.createCheckout', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let gateway: {
    name: string;
    createCheckout: jest.Mock;
    verifyWebhook: jest.Mock;
    parseWebhookEvent: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    gateway = {
      name: 'fake',
      createCheckout: jest.fn().mockResolvedValue({
        checkoutUrl: 'https://gw.test/c/pi_1',
        gatewayChargeId: null,
      }),
      verifyWebhook: jest.fn(),
      parseWebhookEvent: jest.fn(),
    };
    prisma.paymentIntent.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'pi_1', ...args.data }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_GATEWAY_PORT, useValue: gateway },
        { provide: WalletService, useValue: { credit: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (_k: string, d?: string) => d ?? 'https://flick.test',
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('stores the server-resolved price, ignoring anything the client might want', async () => {
    await service.createCheckout('u1', {
      itemType: 'SUBSCRIPTION',
      itemId: 'weekly',
    });

    const created = prisma.paymentIntent.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.amountSatangs).toBe(4900);
    expect(created.data.status).toBe('PENDING');
    expect(created.data.userId).toBe('u1');
    expect(created.data.idempotencyKey).toEqual(expect.any(String));
    expect(created.data.expiresAt).toEqual(expect.any(Date));
  });

  it('passes the intent id to the gateway so the webhook can be tied back', async () => {
    await service.createCheckout('u1', {
      itemType: 'COIN_PACK',
      itemId: 'starter',
    });

    const request = gateway.createCheckout.mock.calls[0][0] as {
      intentId: string;
      amountSatangs: number;
    };
    expect(request.intentId).toBe('pi_1');
    expect(request.amountSatangs).toBe(3500); // ฿35
  });

  it('returns the checkout url and intent id', async () => {
    await expect(
      service.createCheckout('u1', {
        itemType: 'SUBSCRIPTION',
        itemId: 'weekly',
      }),
    ).resolves.toEqual({
      checkoutUrl: 'https://gw.test/c/pi_1',
      intentId: 'pi_1',
    });
  });

  it('rejects an unknown item before creating any intent', async () => {
    await expect(
      service.createCheckout('u1', {
        itemType: 'SUBSCRIPTION',
        itemId: 'nope',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it('records a charge id when the gateway returns one at checkout', async () => {
    gateway.createCheckout.mockResolvedValue({
      checkoutUrl: 'https://gw.test/c/pi_1',
      gatewayChargeId: 'chrg_1',
    });

    await service.createCheckout('u1', {
      itemType: 'SUBSCRIPTION',
      itemId: 'weekly',
    });

    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'pi_1' },
      data: { gatewayChargeId: 'chrg_1' },
    });
  });
});
