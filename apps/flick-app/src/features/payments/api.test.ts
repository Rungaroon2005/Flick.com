import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/apiClient';
import { checkGranted, INITIAL_CHECKOUT_BASELINE, type CheckoutBaseline } from './api';

vi.mock('@/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function subscription(endDate: string) {
  return {
    id: 'sub-1',
    userId: 'user-1',
    planType: 'monthly',
    status: 'ACTIVE' as const,
    autoRenew: false,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate,
    paymentMethod: 'fake',
    gatewaySubscriptionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('checkGranted — SUBSCRIPTION', () => {
  it('grants a first-time purchase (no baseline) as soon as any subscription appears', async () => {
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const baseline: CheckoutBaseline = { balance: null, subscriptionEndDate: null };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(true);
  });

  it('does NOT grant a renewal-before-expiry just because the OLD subscription still exists', async () => {
    const oldEndDate = '2026-09-01T00:00:00.000Z';
    mockedApiFetch.mockResolvedValueOnce(subscription(oldEndDate));

    const baseline: CheckoutBaseline = { balance: null, subscriptionEndDate: oldEndDate };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(false);
  });

  it('grants a renewal once a subscription with a LATER endDate appears', async () => {
    const oldEndDate = '2026-09-01T00:00:00.000Z';
    const newEndDate = '2026-10-01T00:00:00.000Z';
    mockedApiFetch.mockResolvedValueOnce(subscription(newEndDate));

    const baseline: CheckoutBaseline = { balance: null, subscriptionEndDate: oldEndDate };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(true);
  });

  it('does not grant when no subscription exists yet', async () => {
    mockedApiFetch.mockResolvedValueOnce(undefined);

    const result = await checkGranted('SUBSCRIPTION', { balance: null, subscriptionEndDate: null });

    expect(result.granted).toBe(false);
  });

  it('falls back to granting on any subscription when the baseline was never captured', async () => {
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const result = await checkGranted('SUBSCRIPTION', {
      balance: null,
      subscriptionEndDate: undefined,
    });

    expect(result.granted).toBe(true);
  });
});

describe('checkGranted — COIN_PACK', () => {
  it('does not grant on the first poll, which becomes the baseline', async () => {
    mockedApiFetch.mockResolvedValueOnce({ balance: 100 });

    const result = await checkGranted('COIN_PACK', { balance: null, subscriptionEndDate: undefined });

    expect(result.granted).toBe(false);
    expect(result.baseline.balance).toBe(100);
  });

  it('grants once the balance rises above the baseline', async () => {
    mockedApiFetch.mockResolvedValueOnce({ balance: 150 });

    const result = await checkGranted('COIN_PACK', { balance: 100, subscriptionEndDate: undefined });

    expect(result.granted).toBe(true);
  });
});

describe('checkGranted — item type unknown (sessionStorage fallback)', () => {
  it('does not false-positive on a pre-existing subscription when only a coin-pack purchase is in flight', async () => {
    // First tick: an already-subscribed user's coin-pack checkout, with no
    // sessionStorage data (itemType unknown). The pre-existing subscription
    // and current balance are captured as the baseline, not treated as a
    // grant.
    mockedApiFetch
      .mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z')) // /subscriptions/me
      .mockResolvedValueOnce({ balance: 100 }); // /wallet

    const first = await checkGranted(null, INITIAL_CHECKOUT_BASELINE);
    expect(first.granted).toBe(false);
    expect(first.baseline).toEqual({ balance: 100, subscriptionEndDate: '2026-09-23T00:00:00.000Z' });

    // Second tick: the SAME pre-existing subscription is still there and the
    // balance is unchanged — still no grant.
    mockedApiFetch
      .mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'))
      .mockResolvedValueOnce({ balance: 100 });
    const second = await checkGranted(null, first.baseline);
    expect(second.granted).toBe(false);

    // Third tick: the coin-pack webhook lands and the balance rises — now
    // it grants.
    mockedApiFetch
      .mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'))
      .mockResolvedValueOnce({ balance: 150 });
    const third = await checkGranted(null, second.baseline);
    expect(third.granted).toBe(true);
  });

  it('grants when a subscription with a later endDate appears after the baseline tick', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(undefined) // /subscriptions/me — nothing yet
      .mockResolvedValueOnce({ balance: 100 }); // /wallet

    const first = await checkGranted(null, INITIAL_CHECKOUT_BASELINE);
    expect(first.granted).toBe(false);
    expect(first.baseline.subscriptionEndDate).toBeNull();

    mockedApiFetch
      .mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'))
      .mockResolvedValueOnce({ balance: 100 });
    const second = await checkGranted(null, first.baseline);
    expect(second.granted).toBe(true);
  });
});
