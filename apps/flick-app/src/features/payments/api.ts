// Payment actions for Flick. Checkout hands back a gateway URL; the browser
// leaves the app entirely (full navigation, never router.push — the URL is on
// the gateway's origin). Only a signature-verified webhook on the API grants
// anything: see apps/flick-api/src/payments/payments.service.ts. This file
// starts that trip, remembers what the trip was for, and decides — honestly,
// against a pre-checkout baseline — whether the processing screen has
// actually seen a NEW grant land, not just a pre-existing entitlement.
'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { safeNext } from '@/lib/nextParam';

export type CheckoutItemType = 'SUBSCRIPTION';

export type CheckoutResult =
  | { success: true; checkoutUrl: string; intentId: string }
  | { success: false; error: string };

/**
 * Starts a purchase. Note what is not sent: no price. The server resolves the
 * amount from its own catalog, so the client cannot propose one.
 */
export async function startCheckout(
  itemType: CheckoutItemType,
  itemId: string,
): Promise<CheckoutResult> {
  try {
    const data = await apiFetch('/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ itemType, itemId }),
    });
    return { success: true, checkoutUrl: data.checkoutUrl, intentId: data.intentId };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof ApiError
          ? err.message
          : 'ไม่สามารถเริ่มการชำระเงินได้ กรุณาลองใหม่',
    };
  }
}

const PENDING_CHECKOUT_KEY = 'flick:pendingCheckout';

interface PendingCheckout {
  itemType: CheckoutItemType;
  intentId: string;
  /** The active subscription's endDate (if any) at the moment checkout was
   *  started, or null if there was no active subscription. Renewal-before-
   *  expiry is a real flow here (no auto-renew — see the plan doc — so
   *  buying again while still entitled is expected), so "a subscription
   *  exists" is not proof of a NEW grant; only "a subscription with a later
   *  endDate than this baseline" is. Left undefined if the pre-checkout
   *  fetch failed — the processing screen then falls back to treating any
   *  subscription as a grant, same as it would for a genuine first-time
   *  purchase. */
  baselineSubscriptionEndDate?: string | null;
  /** Where to land once the grant is confirmed. Validated on the way in and
   *  again on the way out: sessionStorage is writable by any script on the
   *  origin, so a stored value is no more trusted than a URL param. */
  next?: string;
}

/**
 * Stashes what the processing screen needs once the browser returns from the
 * gateway. The API's return URL only carries `?intent=<id>` (see
 * PaymentsService.createCheckout) — it has no item type — so this is the only
 * way the processing screen learns whether to watch /subscriptions/me for
 * the entitlement, and what "before" looked like. Best-effort: sessionStorage
 * can be unavailable (private browsing, a different tab) and that is never
 * fatal — the processing screen falls back to polling when it finds nothing.
 */
export async function rememberPendingCheckout(
  itemType: CheckoutItemType,
  intentId: string,
  next?: string | null,
): Promise<void> {
  const pending: PendingCheckout = { itemType, intentId };
  const safe = safeNext(next);
  if (safe) pending.next = safe;
  try {
    const subscription = await apiFetch('/subscriptions/me');
    pending.baselineSubscriptionEndDate = subscription ? subscription.endDate : null;
  } catch {
    // No baseline available — left undefined, so the processing screen
    // grants on any subscription appearing (same as a first-time buyer).
  }
  try {
    sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
  } catch {
    // sessionStorage unavailable — nothing more to do here.
  }
}

/** Reads back what rememberPendingCheckout stored, scoped to the intent id
 *  the gateway actually returned with. A missing/mismatched `intentId` is
 *  treated the same as no stored data at all — this function never hands
 *  back state for an intent other than the one actually in the URL. */
export function recallPendingCheckout(intentId: string | null): PendingCheckout | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCheckout>;
    if (parsed.itemType !== 'SUBSCRIPTION' || typeof parsed.intentId !== 'string') {
      return null;
    }
    if (parsed.intentId !== intentId) return null;
    return { ...parsed, next: safeNext(parsed.next) ?? undefined } as PendingCheckout;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  try {
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {
    // ignore
  }
}

/** What checkGranted compares each poll against. Threaded through the
 *  polling loop the same way from tick to tick, updated only when a value
 *  gets captured for the first time. */
export interface CheckoutBaseline {
  /** undefined = never captured (fetch failed, or not applicable to this
   *  poll yet); null = captured, no active subscription existed; string =
   *  captured, the pre-existing subscription's endDate. */
  subscriptionEndDate: string | null | undefined;
}

export const INITIAL_CHECKOUT_BASELINE: CheckoutBaseline = {
  subscriptionEndDate: undefined,
};

/** True only when `subscription` represents strictly MORE entitlement than
 *  `baselineEndDate` did — never merely "a subscription exists", since an
 *  existing subscriber renewing before expiry is a normal, expected flow
 *  here (no auto-renew: a plan simply expires and the user buys again). */
function isNewerSubscription(
  subscription: { endDate: string } | null | undefined,
  baselineEndDate: string | null | undefined,
): boolean {
  if (!subscription) return false;
  if (baselineEndDate === null || baselineEndDate === undefined) {
    // Nothing to compare against — either genuinely a first-time purchase
    // (no prior subscription existed) or the baseline capture itself
    // failed. Either way, any subscription appearing now is the new grant.
    return true;
  }
  return new Date(subscription.endDate).getTime() > new Date(baselineEndDate).getTime();
}

/**
 * Returns true once whatever the user paid for is confirmed granted, judged
 * against a pre-checkout baseline so a pre-existing entitlement can never
 * itself read as "granted". This is the ONLY thing that may tell the
 * processing screen to redirect — never the mere fact that the browser
 * returned from the gateway, which proves nothing (see
 * PaymentsService.createCheckout's comment on the same point).
 */
export async function checkGranted(
  itemType: CheckoutItemType | null,
  baseline: CheckoutBaseline,
): Promise<{ granted: boolean; baseline: CheckoutBaseline }> {
  if (itemType === 'SUBSCRIPTION') {
    const subscription = await apiFetch('/subscriptions/me');
    return {
      granted: isNewerSubscription(subscription, baseline.subscriptionEndDate),
      baseline,
    };
  }

  // Item type unknown (different tab/device, cleared storage, or a direct
  // navigation to this URL). The baseline gets CAPTURED on this tick rather
  // than compared, so a pre-existing subscription can never itself read as
  // "granted".
  const subscription = await apiFetch('/subscriptions/me');

  if (baseline.subscriptionEndDate === undefined) {
    return {
      granted: false,
      baseline: { subscriptionEndDate: subscription ? subscription.endDate : null },
    };
  }

  return {
    granted: isNewerSubscription(subscription, baseline.subscriptionEndDate),
    baseline,
  };
}
