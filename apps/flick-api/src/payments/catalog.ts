import { BadRequestException } from '@nestjs/common';
import {
  COIN_PACKS,
  PLAN_DURATIONS_MS,
  SUBSCRIPTION_PLANS,
  type PaidPlanId,
} from '../plans/plans.config';

export type CatalogItemType = 'SUBSCRIPTION' | 'COIN_PACK';

export interface ResolvedCatalogItem {
  itemType: CatalogItemType;
  itemId: string;
  /** Smallest currency unit. Never a float, never client-supplied. */
  amountSatangs: number;
  description: string;
  /** COIN_PACK only — how many coins to credit on success. */
  coins?: number;
  /** SUBSCRIPTION only — how long the entitlement lasts. */
  durationMs?: number;
}

/** plans.config.ts stores baht; the ledger stores satangs. */
const SATANGS_PER_BAHT = 100;

const UNKNOWN_PLAN = 'ไม่พบแพ็กเกจนี้ (Unknown plan)';
const UNKNOWN_PACK = 'ไม่พบแพ็กเหรียญนี้ (Unknown coin pack)';

/**
 * Turns a client-supplied item identifier into a server-owned price. The
 * client never sends an amount, so there is nothing to validate against —
 * only an id to look up, and an exception if it is not in the catalog.
 */
export function resolveCatalogItem(
  itemType: CatalogItemType,
  itemId: string,
): ResolvedCatalogItem {
  if (itemType === 'SUBSCRIPTION') {
    // hasOwnProperty, not `in` or a bare index: `PLAN_DURATIONS_MS['constructor']`
    // is truthy via the prototype chain and would resolve a plan that does
    // not exist.
    if (!Object.prototype.hasOwnProperty.call(PLAN_DURATIONS_MS, itemId)) {
      throw new BadRequestException(UNKNOWN_PLAN);
    }
    const plan = SUBSCRIPTION_PLANS.find(
      (candidate) => candidate.id === itemId,
    );
    // A plan present in PLAN_DURATIONS_MS but priced at 0 (or missing from the
    // display list) is not purchasable.
    if (!plan || plan.price <= 0) throw new BadRequestException(UNKNOWN_PLAN);

    return {
      itemType,
      itemId,
      amountSatangs: plan.price * SATANGS_PER_BAHT,
      description: `Flick ${plan.nameEn}`,
      durationMs: PLAN_DURATIONS_MS[itemId as PaidPlanId],
    };
  }

  const pack = COIN_PACKS.find((candidate) => candidate.id === itemId);
  if (!pack || pack.price <= 0) throw new BadRequestException(UNKNOWN_PACK);

  return {
    itemType,
    itemId,
    amountSatangs: pack.price * SATANGS_PER_BAHT,
    description: `Flick ${pack.name} (${pack.coins} coins)`,
    coins: pack.coins,
  };
}
