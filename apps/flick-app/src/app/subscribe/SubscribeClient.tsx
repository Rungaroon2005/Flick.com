'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { Icon } from '@/components/ui/Icon';
import { CoinPack, SubscriptionPlan } from '@/types';

// There is no payment gateway in this project. Coin top-ups therefore stay
// disabled: the old handler wrote a fake coin balance to localStorage and
// reported "purchase successful" for a payment that never happened.
const UNAVAILABLE_MSG = 'ระบบชำระเงินยังไม่เปิดให้บริการในขณะนี้ ใช้งานฟรีได้ทุกฟีเจอร์ด้านล่าง';

const FREE_PLAN_ID = 'free';

/** Plan and pricing copy remains server-owned. Paid actions stay disabled until
 *  the API has a verified payment-gateway activation path. */
export default function SubscribeClient() {
  const router = useRouter();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [coinPacks, setCoinPacks] = useState<CoinPack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // GET /plans is public, but apiFetch is still the only way out of the
    // browser so the error shape stays consistent with the rest of the app.
    apiFetch<{ subscriptions: SubscriptionPlan[]; coins: CoinPack[] }>('/plans')
      .then((data) => {
        if (cancelled) return;
        setPlans(data.subscriptions);
        setCoinPacks(data.coins);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setLoadError('ไม่สามารถโหลดแพ็กเกจได้');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-ink pb-10">
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={() => router.push('/home')}
          aria-label="ปิด"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-fg/10 text-fg"
        >
          <Icon name="close" size={18} />
        </button>
        <h1 className="text-title font-display">เลือกแพ็กเกจของคุณ</h1>
      </header>

      <section className="px-5">
        {loadError && (
          <p className="mb-3 flex items-center gap-2 text-sm text-fail">
            <Icon name="alertCircle" size={16} />
            {loadError}
          </p>
        )}
        <p className="mb-5 flex items-start gap-2 rounded-lg bg-ink-1 p-3 text-sm text-fg-dim">
          <Icon name="infoCircle" size={16} className="mt-0.5 shrink-0 text-fg-mute" />
          {UNAVAILABLE_MSG}
        </p>

        <div className="flex flex-col gap-4">
          {plans.map((plan) => {
            // The free plan is identified from the data, never from JSX order.
            // It navigates normally; paid plans render as previews.
            const isFree = plan.id === FREE_PLAN_ID || plan.price === 0;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-5 ${isFree ? 'border-brand-ink' : 'border-hairline opacity-90'}`}
              >
                {plan.badge && !isFree && (
                  <span className="absolute -top-2.5 right-5 rounded-full bg-coin px-3 py-1 text-xs font-semibold text-ink">
                    {plan.badge}
                  </span>
                )}
                {!isFree && (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-ink-2 px-3 py-1 text-xs font-medium text-fg-dim">
                    เร็ว ๆ นี้
                  </span>
                )}
                <h2 className="text-lg font-bold text-fg">{plan.name}</h2>
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
                    className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-brand font-semibold text-white transition-transform active:scale-95"
                  >
                    ใช้งานฟรี
                  </button>
                ) : (
                  <button
                    disabled
                    className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-ink-2 font-semibold text-fg-mute"
                  >
                    เร็ว ๆ นี้
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8 px-5">
        <h2 className="text-lg font-bold text-fg">เติมเหรียญ (สำหรับปลดล็อคตอน)</h2>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {coinPacks.map((pack) => (
            <div
              key={pack.id}
              className="relative flex flex-col items-center gap-1 rounded-xl border border-hairline p-4 text-center opacity-90"
            >
              {pack.badge && (
                <span className="absolute -top-2.5 rounded-full bg-coin px-2.5 py-0.5 text-[10px] font-semibold text-ink">
                  {pack.badge}
                </span>
              )}
              <div className="mt-1 flex items-center gap-1 text-data text-coin">
                <Icon name="coin" size={16} />
                {pack.coins}
              </div>
              <div className="text-sm text-fg-dim">฿{pack.price}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
