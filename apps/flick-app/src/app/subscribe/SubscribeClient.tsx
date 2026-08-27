'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Icon } from '@/components/ui/Icon';
import { rememberPendingCheckout, startCheckout } from '@/features/payments';
import { SubscriptionPlan } from '@/types';

const FREE_PLAN_ID = 'free';

/** Plan copy remains server-owned: SubscriptionPlan ids and prices come
 *  straight from GET /plans and are never re-derived on the client. What
 *  this component sends to POST /payments/checkout is only the chosen id —
 *  never a price — so the server-resolved catalog amount is the only
 *  amount that can ever be charged. */
function SubscribeForm({ plans }: { plans: SubscriptionPlan[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const handleBuy = async (itemId: string) => {
    setBusyItem(itemId);
    setError('');
    const result = await startCheckout('SUBSCRIPTION', itemId);
    if (!result.success) {
      setBusyItem(null);
      setError(result.error);
      return;
    }
    // Remembered so /subscribe/processing knows what to poll for — the
    // gateway's return URL only carries the intent id, not the item type.
    await rememberPendingCheckout('SUBSCRIPTION', result.intentId, searchParams.get('next'));
    // Full navigation, not router.push — the checkout page is the gateway's
    // origin, not ours. location.assign(), not `location.href =`: this
    // version's react-hooks/react-compiler lint rule flags a direct property
    // assignment on `window.location` from inside a component as mutating a
    // frozen value; the equivalent method call is not flagged (see how
    // PlayerClient.tsx's existing window.location.reload() call passes).
    window.location.assign(result.checkoutUrl);
  };

  return (
    <div className="min-h-dvh bg-ink pb-10">
      <Container>
        <header className="flex items-center gap-3 py-4">
          <button
            onClick={() => router.push('/home')}
            aria-label="ปิด"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-fg/10 text-fg transition-all duration-surface ease-enter hover:bg-fg/15 active:scale-90"
          >
            <Icon name="close" size={18} />
          </button>
          <h1 className="text-title font-display">เลือกแพ็กเกจของคุณ</h1>
        </header>
      </Container>

      <Container>
        <section>
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-center gap-2 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail"
            >
              <Icon name="alertCircle" size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col gap-5 md:grid md:grid-cols-2 md:items-start">
            {plans.map((plan) => {
              // The free plan is identified from the data, never from JSX order.
              const isFree = plan.id === FREE_PLAN_ID || plan.price === 0;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-3xl border p-6 shadow-lg shadow-black/20 transition-all duration-surface ease-enter ${isFree ? 'border-brand-ink' : 'border-white/10'}`}
                >
                  {plan.badge && (
                    <span className="absolute -top-2.5 right-5 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink">
                      {plan.badge}
                    </span>
                  )}
                  <h2 className="font-display text-lg font-bold text-fg">{plan.name}</h2>
                  <div className="mt-1 text-2xl font-extrabold text-fg">
                    ฿{plan.price} <span className="text-sm font-normal text-fg-dim">{plan.period}</span>
                  </div>
                  <ul className="mt-4 flex flex-col gap-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-fg-dim">
                        <Icon name="checkCircle" size={16} className="shrink-0 text-ok" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {isFree ? (
                    <button
                      onClick={() => router.push('/home')}
                      className="focus-ring mt-5 flex h-11 w-full items-center justify-center rounded-full bg-brand font-semibold text-ink shadow-lg shadow-black/25 transition-all duration-surface ease-enter hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
                    >
                      ใช้งานฟรี
                    </button>
                  ) : (
                    <Button
                      variant="primary"
                      size="lg"
                      className="mt-5 w-full"
                      loading={busyItem === plan.id}
                      disabled={busyItem !== null && busyItem !== plan.id}
                      onClick={() => handleBuy(plan.id)}
                    >
                      สมัครแพ็กเกจนี้
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </Container>
    </div>
  );
}

// useSearchParams bails a static build's Client Component tree out to client
// rendering up to the nearest Suspense boundary; without one, `next build`
// fails with "Missing Suspense boundary with useSearchParams" (same fix as
// /login and /subscribe/processing).
export default function SubscribeClient({ plans }: { plans: SubscriptionPlan[] }) {
  return (
    <Suspense fallback={null}>
      <SubscribeForm plans={plans} />
    </Suspense>
  );
}
