'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiClient';
import { Icon } from '@/components/ui/Icon';
import { clearPendingCheckout, recallPendingCheckout } from '@/features/payments';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Returns true once whatever the user paid for is confirmed granted. This is
 * the ONLY thing that may redirect to /home — never the fact that the browser
 * merely returned from the gateway, which proves nothing (see
 * PaymentsService.createCheckout's comment on the same point).
 */
async function checkGranted(
  itemType: 'SUBSCRIPTION' | 'COIN_PACK' | null,
  baselineBalance: number | null,
): Promise<{ granted: boolean; baselineBalance: number | null }> {
  if (itemType === 'SUBSCRIPTION') {
    const subscription = await apiFetch('/subscriptions/me');
    return { granted: Boolean(subscription), baselineBalance };
  }

  if (itemType === 'COIN_PACK') {
    const wallet = await apiFetch('/wallet');
    if (baselineBalance === null) {
      // No baseline could be captured before checkout (sessionStorage lost
      // it, or the pre-checkout /wallet read failed) — this poll becomes the
      // baseline instead. A false negative for this one tick is the honest
      // trade-off: we cannot claim "granted" without something to compare to.
      return { granted: false, baselineBalance: wallet.balance };
    }
    return { granted: wallet.balance > baselineBalance, baselineBalance };
  }

  // Item type unknown (different tab/device, cleared storage, or a direct
  // navigation to this URL) — watch both signals so a real grant is still
  // caught, just without a coin baseline captured ahead of time.
  const [subscription, wallet] = await Promise.all([
    apiFetch('/subscriptions/me'),
    apiFetch('/wallet'),
  ]);
  if (baselineBalance === null) {
    return { granted: Boolean(subscription), baselineBalance: wallet.balance };
  }
  return {
    granted: Boolean(subscription) || wallet.balance > baselineBalance,
    baselineBalance,
  };
}

function ProcessingScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intentId = searchParams.get('intent');
  const [timedOut, setTimedOut] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();

    const pending = recallPendingCheckout(intentId);
    const itemType = pending?.itemType ?? null;
    let baselineBalance = pending?.baselineBalance ?? null;

    const poll = async () => {
      try {
        // The webhook is the only thing that grants access, and it may land
        // before, during, or after this redirect. Polling our OWN API is the
        // only honest way to know — the gateway's return URL proves nothing.
        const result = await checkGranted(itemType, baselineBalance);
        baselineBalance = result.baselineBalance;
        if (!cancelled && result.granted) {
          clearPendingCheckout();
          router.replace('/home');
          router.refresh();
          return;
        }
      } catch {
        // A transient failure is not a failed payment — keep polling.
      }

      if (cancelled) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router, intentId]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
      {timedOut ? (
        <>
          <Icon name="infoCircle" size={28} className="text-fg-mute" />
          <h1 className="text-title font-display">การชำระเงินอาจใช้เวลาสักครู่</h1>
          {/* Deliberately neither "paid" nor "failed": we genuinely do not
              know yet, and claiming either would be a lie. */}
          <p className="max-w-sm text-sm text-fg-dim">
            เราจะเปิดใช้งานให้อัตโนมัติเมื่อได้รับการยืนยันจากผู้ให้บริการชำระเงิน
          </p>
          <Link href="/home" className="mt-2 font-medium text-brand-ink">
            กลับหน้าแรก
          </Link>
        </>
      ) : (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-brand-ink" />
          <h1 className="text-title font-display">กำลังตรวจสอบการชำระเงิน...</h1>
          <p className="text-sm text-fg-dim">กรุณาอย่าปิดหน้านี้</p>
        </>
      )}
    </div>
  );
}

function ProcessingFallback() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-brand-ink" />
      <h1 className="text-title font-display">กำลังตรวจสอบการชำระเงิน...</h1>
      <p className="text-sm text-fg-dim">กรุณาอย่าปิดหน้านี้</p>
    </div>
  );
}

// useSearchParams bails a static build's Client Component tree out to client
// rendering up to the nearest Suspense boundary; without one, `next build`
// fails with "Missing Suspense boundary with useSearchParams" (Next.js docs,
// app/api-reference/functions/use-search-params — "Behavior > Prerendering").
export default function PaymentProcessingPage() {
  return (
    <Suspense fallback={<ProcessingFallback />}>
      <ProcessingScreen />
    </Suspense>
  );
}
