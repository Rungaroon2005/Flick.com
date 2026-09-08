'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import {
  checkGranted,
  clearPendingCheckout,
  recallPendingCheckout,
  INITIAL_CHECKOUT_BASELINE,
  type CheckoutBaseline,
} from '@/features/payments';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

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
    const destination = pending?.next ?? '/home';
    // NB: `??` is deliberately NOT used for subscriptionEndDate below — it
    // would conflate "captured as null (no prior subscription)" with
    // "never captured (undefined)", and those two states must stay distinct
    // (see CheckoutBaseline's doc comment and isNewerSubscription).
    let baseline: CheckoutBaseline = {
      subscriptionEndDate: pending ? pending.baselineSubscriptionEndDate : INITIAL_CHECKOUT_BASELINE.subscriptionEndDate,
    };

    const poll = async () => {
      try {
        // The webhook is the only thing that grants access, and it may land
        // before, during, or after this redirect. Polling our OWN API is the
        // only honest way to know — the gateway's return URL proves nothing.
        // checkGranted judges against `baseline`, so a pre-existing
        // entitlement (e.g. renewing a subscription before it expires) can
        // never itself read as "granted".
        const result = await checkGranted(itemType, baseline);
        baseline = result.baseline;
        if (!cancelled && result.granted) {
          clearPendingCheckout();
          // push, not replace: back should return to the episode, not to the
          // gateway we just came from.
          router.push(destination);
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
