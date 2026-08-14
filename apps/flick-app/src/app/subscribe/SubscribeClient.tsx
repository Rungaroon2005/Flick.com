'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';
import styles from './page.module.css';
import { CoinPack, SubscriptionPlan } from '@/types';

// There is no payment gateway in this project. Coin top-ups therefore stay
// disabled: the old handler wrote a fake coin balance to localStorage and
// reported "purchase successful" for a payment that never happened.
const UNAVAILABLE_MSG = 'ยังไม่เปิดให้ชำระเงินในขณะนี้';

const FREE_PLAN_ID = 'free';

/** The plan cards are rendered from GET /plans, so the id a card POSTs is by
 *  construction the id the API validates against PLAN_DURATIONS_MS. Hardcoding
 *  them in JSX is what produced the 'vip-weekly' bug (฿49 bought 30 days). */
export default function SubscribeClient() {
  const router = useRouter();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [coinPacks, setCoinPacks] = useState<CoinPack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);

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

  const handleSubscribe = async (planId: string) => {
    setError(null);
    setPendingPlanId(planId);
    try {
      await apiFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      router.push('/home');
      // Without this the cached Server Component render of /profile still
      // shows the old membership status when the user navigates back.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'สมัครสมาชิกไม่สำเร็จ');
    } finally {
      setPendingPlanId(null);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.push('/home')} aria-label="ปิด">
          ✕
        </button>
        <h1 className={styles.title}>เลือกแพ็กเกจของคุณ</h1>
      </header>

      <section className={styles.section}>
        {loadError && <p className={styles.unavailableNote}>{loadError}</p>}
        {error && <p className={styles.errorNote}>{error}</p>}
        <div className={styles.plansGrid}>
          {plans.map((plan) => {
            // The free plan is identified from the data, never from JSX order.
            // It must navigate, not POST — the API only accepts paid plan ids.
            const isFree = plan.id === FREE_PLAN_ID || plan.price === 0;
            const pending = pendingPlanId === plan.id;
            return (
              <div key={plan.id} className={styles.planCard} style={{ borderColor: plan.color }}>
                {plan.badge && <div className={styles.badge}>{plan.badge}</div>}
                <h2 className={styles.planName}>{plan.name}</h2>
                <div className={styles.planPrice}>
                  ฿{plan.price} {plan.period}
                </div>
                <ul className={styles.featureList}>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className={styles.checkIcon}>✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>
                {isFree ? (
                  <button
                    className={`${styles.selectBtn} ${styles.btnFree}`}
                    onClick={() => router.push('/home')}
                  >
                    ใช้งานฟรี
                  </button>
                ) : (
                  <button
                    className={`${styles.selectBtn} ${styles.btnSubscribe}`}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={pendingPlanId !== null}
                  >
                    {pending ? 'กำลังดำเนินการ...' : 'สมัครสมาชิก'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>เติมเหรียญ (สำหรับปลดล็อคตอน)</h2>
        <div className={styles.coinsGrid}>
          {coinPacks.map((pack) => (
            <div key={pack.id} className={`${styles.coinCard} ${styles.coinCardDisabled}`}>
              {pack.badge && <div className={styles.badge}>{pack.badge}</div>}
              <div className={styles.coinAmount}>
                <span aria-hidden="true">🟡</span> {pack.coins}
              </div>
              <div className={styles.coinPrice}>฿{pack.price}</div>
            </div>
          ))}
        </div>
        <p className={styles.unavailableNote}>{UNAVAILABLE_MSG}</p>
      </section>
    </div>
  );
}
