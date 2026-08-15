'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import styles from './page.module.css';
import { CoinPack, SubscriptionPlan } from '@/types';

// There is no payment gateway in this project. Coin top-ups therefore stay
// disabled: the old handler wrote a fake coin balance to localStorage and
// reported "purchase successful" for a payment that never happened.
const UNAVAILABLE_MSG = 'ยังไม่เปิดให้ชำระเงินในขณะนี้';

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
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.push('/home')} aria-label="ปิด">
          ✕
        </button>
        <h1 className={styles.title}>เลือกแพ็กเกจของคุณ</h1>
      </header>

      <section className={styles.section}>
        {loadError && <p className={styles.unavailableNote}>{loadError}</p>}
        <p className={styles.unavailableNote}>{UNAVAILABLE_MSG}</p>
        <div className={styles.plansGrid}>
          {plans.map((plan) => {
            // The free plan is identified from the data, never from JSX order.
            // It navigates normally; paid actions remain deliberately disabled.
            const isFree = plan.id === FREE_PLAN_ID || plan.price === 0;
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
                    disabled
                  >
                    ยังไม่เปิดให้บริการ
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
