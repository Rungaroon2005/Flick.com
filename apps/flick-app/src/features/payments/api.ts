// Payment actions for Flick. Checkout hands back a gateway URL; the browser
// leaves the app entirely (full navigation, never router.push — the URL is on
// the gateway's origin). Only a signature-verified webhook on the API grants
// anything: see apps/flick-api/src/payments/payments.service.ts. This file
// starts that trip and remembers what the trip was for, so the processing
// screen on the way back knows what to poll for.
'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';

export type CheckoutItemType = 'SUBSCRIPTION' | 'COIN_PACK';

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
  /** Wallet balance captured right before leaving for the gateway. COIN_PACK
   *  only. Lets the processing screen notice a credit that lands before the
   *  screen itself ever mounts — a plain "did it change since I loaded"
   *  check would miss that case. */
  baselineBalance?: number;
}

/**
 * Stashes what the processing screen needs once the browser returns from the
 * gateway. The API's return URL only carries `?intent=<id>` (see
 * PaymentsService.createCheckout) — it has no item type — so this is the only
 * way the processing screen learns whether to watch /subscriptions/me or
 * /wallet for the entitlement. Best-effort: sessionStorage can be unavailable
 * (private browsing, a different tab) and that is never fatal — the
 * processing screen falls back to polling both signals when it finds nothing.
 */
export async function rememberPendingCheckout(
  itemType: CheckoutItemType,
  intentId: string,
): Promise<void> {
  const pending: PendingCheckout = { itemType, intentId };
  if (itemType === 'COIN_PACK') {
    try {
      const wallet = await apiFetch('/wallet');
      pending.baselineBalance = wallet.balance;
    } catch {
      // No baseline available — the processing screen uses its first poll
      // as the baseline instead.
    }
  }
  try {
    sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
  } catch {
    // sessionStorage unavailable — nothing more to do here.
  }
}

/** Reads back what rememberPendingCheckout stored, scoped to the intent id
 *  the gateway actually returned with (when one is present in the URL). */
export function recallPendingCheckout(intentId: string | null): PendingCheckout | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCheckout>;
    if (
      (parsed.itemType !== 'SUBSCRIPTION' && parsed.itemType !== 'COIN_PACK') ||
      typeof parsed.intentId !== 'string'
    ) {
      return null;
    }
    if (intentId && parsed.intentId !== intentId) return null;
    return parsed as PendingCheckout;
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
