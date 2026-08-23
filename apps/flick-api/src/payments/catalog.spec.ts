import { BadRequestException } from '@nestjs/common';
import { resolveCatalogItem } from './catalog';
import {
  COIN_PACKS,
  PLAN_DURATIONS_MS,
  SUBSCRIPTION_PLANS,
} from '../plans/plans.config';

describe('resolveCatalogItem', () => {
  it('prices the weekly plan in satangs, not baht', () => {
    const item = resolveCatalogItem('SUBSCRIPTION', 'weekly');
    expect(item.amountSatangs).toBe(4900); // ฿49
    expect(item.durationMs).toBe(PLAN_DURATIONS_MS.weekly);
  });

  it('prices the monthly plan with its own duration', () => {
    const item = resolveCatalogItem('SUBSCRIPTION', 'monthly');
    expect(item.amountSatangs).toBe(14900);
    // The bug plans.config.ts documents: weekly must never get the monthly
    // duration.
    expect(item.durationMs).toBe(PLAN_DURATIONS_MS.monthly);
    expect(item.durationMs).not.toBe(PLAN_DURATIONS_MS.weekly);
  });

  it('resolves every paid plan and coin pack in the config', () => {
    for (const id of Object.keys(PLAN_DURATIONS_MS)) {
      expect(() => resolveCatalogItem('SUBSCRIPTION', id)).not.toThrow();
    }
    for (const pack of COIN_PACKS) {
      const item = resolveCatalogItem('COIN_PACK', pack.id);
      expect(item.coins).toBe(pack.coins);
      expect(item.amountSatangs).toBe(pack.price * 100);
    }
  });

  it('rejects the free plan — there is nothing to charge for', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'free')).toThrow(
      BadRequestException,
    );
  });

  it('rejects the legacy client id that caused the ฿49-for-30-days bug', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'vip-weekly')).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown ids and cross-type ids', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'nope')).toThrow(
      BadRequestException,
    );
    expect(() => resolveCatalogItem('COIN_PACK', 'nope')).toThrow(
      BadRequestException,
    );
    // A coin pack id must not resolve as a subscription.
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'starter')).toThrow(
      BadRequestException,
    );
    expect(() => resolveCatalogItem('COIN_PACK', 'weekly')).toThrow(
      BadRequestException,
    );
  });

  it('rejects prototype-pollution style ids', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'constructor')).toThrow(
      BadRequestException,
    );
    expect(() => resolveCatalogItem('SUBSCRIPTION', '__proto__')).toThrow(
      BadRequestException,
    );
  });

  it('never produces a fractional amount', () => {
    for (const plan of SUBSCRIPTION_PLANS.filter((p) => p.price > 0)) {
      const item = resolveCatalogItem('SUBSCRIPTION', plan.id);
      expect(Number.isInteger(item.amountSatangs)).toBe(true);
    }
  });
});

describe('resolveCatalogItem — prototype-pollution guard', () => {
  it('rejects an item id that only exists as an inherited Object.prototype property', () => {
    jest.isolateModules(() => {
      jest.doMock('../plans/plans.config', () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const actual = jest.requireActual('../plans/plans.config');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return {
          ...actual,
          // A plan whose id collides with an Object.prototype method name.
          // PLAN_DURATIONS_MS deliberately has NO 'toString' key — only
          // weekly/monthly — so a naive `itemId in PLAN_DURATIONS_MS` check
          // would still see 'toString' as present (inherited from
          // Object.prototype), fall through, find this plan below, and
          // incorrectly resolve it.
          SUBSCRIPTION_PLANS: [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            ...actual.SUBSCRIPTION_PLANS,
            {
              id: 'toString',
              name: 'Fake',
              nameEn: 'Fake',
              price: 99,
              period: '',
              features: [],
              featuresEn: [],
              badge: null,
              color: '#000',
            },
          ],
        };
      });

      // Re-require AFTER mocking, inside isolateModules, so this fresh
      // module instance sees the mocked config while the file's top-level
      // resolveCatalogItem (used by every other test in this file) is
      // completely unaffected.
      const { resolveCatalogItem: isolatedResolve } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./catalog') as typeof import('./catalog');

      expect(() => isolatedResolve('SUBSCRIPTION', 'toString')).toThrow();
    });
  });
});
