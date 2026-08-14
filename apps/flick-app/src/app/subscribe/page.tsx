'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import API_BASE_URL from '@/lib/api';
import styles from './page.module.css';
import { CoinPack } from '@/types';

// TODO(Task 3.3): wire subscribing and coin top-ups to POST /subscriptions and
// the /wallet endpoints. Until then the controls are disabled: the old handlers
// wrote a fake subscription and a fake coin balance to localStorage and reported
// "purchase successful" for a payment that never happened.
const UNAVAILABLE_MSG = 'ยังไม่เปิดให้ชำระเงินในขณะนี้';

export default function SubscribePage() {
  const router = useRouter();
  const [coinPacks, setCoinPacks] = useState<CoinPack[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/plans`)
      .then(res => res.json())
      .then(data => setCoinPacks(data.coins))
      .catch(err => {
        console.error(err);
        setError('ไม่สามารถโหลดแพ็กเกจได้');
      });
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.push('/home')}>
          ✕
        </button>
        <h1 className={styles.title}>เลือกแพ็กเกจของคุณ</h1>
      </header>

      <section className={styles.section}>
        <div className={styles.plansGrid}>
          {/* Free Plan */}
          <div className={`${styles.planCard} ${styles.planCardFree}`}>
            <h2 className={styles.planName}>Basic</h2>
            <div className={styles.planPrice}>฿0 / เดือน</div>
            <ul className={styles.featureList}>
              <li><span className={styles.checkIcon}>✓</span>ดูฟรีบางตอน</li>
              <li><span className={styles.checkIcon}>✓</span>ความละเอียด 480p</li>
              <li><span className={styles.checkIcon}>✓</span>มีโฆษณาคั่น</li>
            </ul>
            <button className={`${styles.selectBtn} ${styles.btnFree}`} onClick={() => router.push('/home')}>
              ใช้งานฟรี
            </button>
          </div>

          {/* Weekly Plan */}
          <div className={`${styles.planCard} ${styles.planCardWeekly}`}>
            <h2 className={styles.planName}>Weekly VIP</h2>
            <div className={styles.planPrice}>฿49 / สัปดาห์</div>
            <ul className={styles.featureList}>
              <li><span className={styles.checkIcon}>✓</span>ดูฟรีทุกเรื่อง</li>
              <li><span className={styles.checkIcon}>✓</span>ความละเอียด 1080p</li>
              <li><span className={styles.checkIcon}>✓</span>ไม่มีโฆษณา</li>
            </ul>
            <button className={`${styles.selectBtn} ${styles.btnWeekly}`} disabled title={UNAVAILABLE_MSG}>
              สมัครสมาชิก
            </button>
          </div>

          {/* Monthly Plan */}
          <div className={`${styles.planCard} ${styles.planCardMonthly}`}>
            <div className={styles.badge}>คุ้มที่สุด</div>
            <h2 className={styles.planName}>Monthly VIP</h2>
            <div className={styles.planPrice}>฿149 / เดือน</div>
            <ul className={styles.featureList}>
              <li><span className={styles.checkIcon}>✓</span>ดูฟรีทุกเรื่อง</li>
              <li><span className={styles.checkIcon}>✓</span>ความละเอียด 4K</li>
              <li><span className={styles.checkIcon}>✓</span>ไม่มีโฆษณา</li>
              <li><span className={styles.checkIcon}>✓</span>ดาวน์โหลดดูออฟไลน์ได้</li>
            </ul>
            <button className={`${styles.selectBtn} ${styles.btnMonthly}`} disabled title={UNAVAILABLE_MSG}>
              สมัครสมาชิก
            </button>
          </div>
        </div>
        <p className={styles.unavailableNote}>{UNAVAILABLE_MSG}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>เติมเหรียญ (สำหรับปลดล็อคตอน)</h2>
        {error && <p className={styles.unavailableNote}>{error}</p>}
        <div className={styles.coinsGrid}>
          {coinPacks.map(pack => (
            <div key={pack.id} className={`${styles.coinCard} ${styles.coinCardDisabled}`}>
              {pack.badge && <div className={styles.badge}>{pack.badge}</div>}
              <div className={styles.coinAmount}>
                <span>🟡</span> {pack.coins}
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
