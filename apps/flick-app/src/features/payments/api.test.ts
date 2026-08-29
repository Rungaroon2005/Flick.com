import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/apiClient';
import {
  checkGranted,
  recallPendingCheckout,
  rememberPendingCheckout,
  INITIAL_CHECKOUT_BASELINE,
  type CheckoutBaseline,
} from './api';

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

    const baseline: CheckoutBaseline = { subscriptionEndDate: null };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(true);
  });

  it('does NOT grant a renewal-before-expiry just because the OLD subscription still exists', async () => {
    const oldEndDate = '2026-09-01T00:00:00.000Z';
    mockedApiFetch.mockResolvedValueOnce(subscription(oldEndDate));

    const baseline: CheckoutBaseline = { subscriptionEndDate: oldEndDate };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(false);
  });

  it('grants a renewal once a subscription with a LATER endDate appears', async () => {
    const oldEndDate = '2026-09-01T00:00:00.000Z';
    const newEndDate = '2026-10-01T00:00:00.000Z';
    mockedApiFetch.mockResolvedValueOnce(subscription(newEndDate));

    const baseline: CheckoutBaseline = { subscriptionEndDate: oldEndDate };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(true);
  });

  it('does not grant when no subscription exists yet', async () => {
    mockedApiFetch.mockResolvedValueOnce(undefined);

    const result = await checkGranted('SUBSCRIPTION', { subscriptionEndDate: null });

    expect(result.granted).toBe(false);
  });

  it('falls back to granting on any subscription when the baseline was never captured', async () => {
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const result = await checkGranted('SUBSCRIPTION', {
      subscriptionEndDate: undefined,
    });

    expect(result.granted).toBe(true);
  });
});

describe('checkGranted — item type unknown (sessionStorage fallback)', () => {
  it('captures the baseline on the first tick instead of granting on a pre-existing subscription', async () => {
    // First tick: no sessionStorage data (itemType unknown, e.g. a
    // different tab). The pre-existing subscription is captured as the
    // baseline, not treated as a grant.
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const first = await checkGranted(null, INITIAL_CHECKOUT_BASELINE);
    expect(first.granted).toBe(false);
    expect(first.baseline).toEqual({ subscriptionEndDate: '2026-09-23T00:00:00.000Z' });

    // Second tick: the SAME pre-existing subscription is still there —
    // still no grant.
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));
    const second = await checkGranted(null, first.baseline);
    expect(second.granted).toBe(false);
  });

  it('grants when a subscription with a later endDate appears after the baseline tick', async () => {
    mockedApiFetch.mockResolvedValueOnce(undefined); // /subscriptions/me — nothing yet

    const first = await checkGranted(null, INITIAL_CHECKOUT_BASELINE);
    expect(first.granted).toBe(false);
    expect(first.baseline.subscriptionEndDate).toBeNull();

    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));
    const second = await checkGranted(null, first.baseline);
    expect(second.granted).toBe(true);
  });
});

describe('pending checkout next', () => {
  it('round-trips a safe next through sessionStorage', async () => {
    await rememberPendingCheckout('SUBSCRIPTION', 'pi_1', '/player/ep-1');
    expect(recallPendingCheckout('pi_1')?.next).toBe('/player/ep-1');
  });

  // A poisoned sessionStorage entry must not become a redirect either.
  it('drops an off-origin next at read time', async () => {
    await rememberPendingCheckout('SUBSCRIPTION', 'pi_2', '//evil.com');
    expect(recallPendingCheckout('pi_2')?.next ?? null).toBeNull();
  });

  it('leaves next null when none was given', async () => {
    await rememberPendingCheckout('SUBSCRIPTION', 'pi_3');
    expect(recallPendingCheckout('pi_3')?.next ?? null).toBeNull();
  });
});
