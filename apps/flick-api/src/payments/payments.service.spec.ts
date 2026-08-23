import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_GATEWAY_PORT } from './payment-gateway.port';
import { createPrismaMock } from '../testing/prisma.mock';
import { PLAN_DURATIONS_MS } from '../plans/plans.config';

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

describe('PaymentsService.handleWebhook', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let wallet: { credit: jest.Mock };
  let gateway: {
    name: string;
    createCheckout: jest.Mock;
    verifyWebhook: jest.Mock;
    parseWebhookEvent: jest.Mock;
  };

  const rawBody = Buffer.from('{"id":"evt_1"}');
  const headers = { 'x-flick-signature': 'sig' };

  const succeededEvent = (overrides = {}) => ({
    gatewayEventId: 'evt_1',
    eventType: 'charge.complete',
    status: 'SUCCEEDED' as const,
    intentId: 'pi_1',
    gatewayChargeId: 'chrg_1',
    amountSatangs: 4900,
    currency: 'THB',
    ...overrides,
  });

  const pendingIntent = (overrides = {}) => ({
    id: 'pi_1',
    userId: 'u1',
    itemType: 'SUBSCRIPTION',
    itemId: 'weekly',
    amountSatangs: 4900,
    currency: 'THB',
    status: 'PENDING',
    gateway: 'fake',
    gatewayChargeId: null,
    idempotencyKey: 'idem-1',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    wallet = { credit: jest.fn().mockResolvedValue(100) };
    gateway = {
      name: 'fake',
      createCheckout: jest.fn(),
      verifyWebhook: jest.fn().mockResolvedValue(true),
      parseWebhookEvent: jest.fn().mockReturnValue(succeededEvent()),
    };
    prisma.paymentEvent.create.mockResolvedValue({ id: 'pe_1' });
    prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_GATEWAY_PORT, useValue: gateway },
        { provide: WalletService, useValue: wallet },
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

  const run = () => service.handleWebhook('fake', rawBody, headers);

  it('verifies the signature over the raw body before parsing', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    await run();

    expect(gateway.verifyWebhook).toHaveBeenCalledWith(rawBody, headers);
    // Order matters: parsing attacker-controlled bytes before verifying them
    // is the bug this assertion exists to catch.
    expect(gateway.verifyWebhook.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.parseWebhookEvent.mock.invocationCallOrder[0],
    );
  });

  it('rejects a forged signature without any database write', async () => {
    gateway.verifyWebhook.mockResolvedValue(false);

    await expect(run()).rejects.toThrow(BadRequestException);
    expect(gateway.parseWebhookEvent).not.toHaveBeenCalled();
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a webhook addressed to a different gateway', async () => {
    await expect(
      service.handleWebhook('someone-else', rawBody, headers),
    ).rejects.toThrow(BadRequestException);
    expect(gateway.verifyWebhook).not.toHaveBeenCalled();
  });

  it('grants a subscription with autoRenew false and the right duration', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());

    await expect(run()).resolves.toEqual({ received: true });

    const created = prisma.subscription.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.userId).toBe('u1');
    expect(created.data.planType).toBe('weekly');
    expect(created.data.status).toBe('ACTIVE');
    // One-time purchase model: nothing auto-charges later.
    expect(created.data.autoRenew).toBe(false);

    const start = created.data.startDate as Date;
    const end = created.data.endDate as Date;
    expect(end.getTime() - start.getTime()).toBe(PLAN_DURATIONS_MS.weekly);
  });

  it('credits coins inside the same transaction as the payment records', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({
        itemType: 'COIN_PACK',
        itemId: 'starter',
        amountSatangs: 3500,
      }),
    );
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ amountSatangs: 3500 }),
    );

    await run();

    expect(wallet.credit).toHaveBeenCalledWith(
      'u1',
      100, // starter pack coins
      TransactionType.PURCHASED,
      expect.stringContaining('starter'),
      'pe_1',
      // The 6th argument is the transaction client — its presence is the
      // whole point of the Task 22 refactor.
      expect.anything(),
    );
  });

  it('treats a duplicate delivery as a no-op and still answers 200', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.paymentEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('never promotes an already-FAILED intent to SUCCEEDED', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ status: 'FAILED' }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('ignores a webhook that arrives after the intent expired', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('refuses to fulfil when the reported amount does not match the intent', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ amountSatangs: 1 }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('grants nothing when the guarded status update matches no rows', async () => {
    // A concurrent delivery won the race and already fulfilled this intent.
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.paymentIntent.updateMany.mockResolvedValue({ count: 0 });

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('records a FAILED event without granting anything', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ status: 'FAILED' }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pi_1', status: 'PENDING' },
        // `as unknown` only satisfies no-unsafe-assignment (the nested matcher
        // is typed `any`); the assertion itself is unchanged.
        data: expect.objectContaining({ status: 'FAILED' }) as unknown,
      }),
    );
  });

  it('answers 200 for an unknown intent rather than making the gateway retry', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(null);

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('stores only allowlisted metadata, never the raw provider payload', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    await run();

    const created = prisma.paymentEvent.create.mock.calls[0][0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(Object.keys(created.data.metadata).sort()).toEqual([
      'gatewayChargeId',
      'intentId',
    ]);
  });
});
