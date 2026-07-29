'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import API_BASE_URL from '@/lib/api';
import { subscribe, addCoins, isLoggedIn } from '@/lib/auth';
import styles from './page.module.css';
import { CoinPack } from '@/types';

export default function SubscribePage() {
  const router = useRouter();
  const [toast, setToast] = useState('');
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

  const handleSubscribe = (planId: string) => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    
    try {
      subscribe(planId);
      router.push('/home');
    } catch (err) {
      console.error(err);
    }
  };

  const handleBuyCoins = (packId: string, amount: number) => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    
    addCoins(amount);
    setToast(`ซื้อสำเร็จ! เพิ่ม ${amount} เหรียญ`);
    setTimeout(() => setToast(''), 3000);
  };

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
            <button className={`${styles.selectBtn} ${styles.btnWeekly}`} onClick={() => handleSubscribe('vip-weekly')}>
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
            <button className={`${styles.selectBtn} ${styles.btnMonthly}`} onClick={() => handleSubscribe('vip-monthly')}>
              สมัครสมาชิก
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>เติมเหรียญ (สำหรับปลดล็อคตอน)</h2>
        <div className={styles.coinsGrid}>
          {coinPacks.map(pack => (
            <div key={pack.id} className={styles.coinCard} onClick={() => handleBuyCoins(pack.id, pack.coins)}>
              {pack.badge && <div className={styles.badge}>{pack.badge}</div>}
              <div className={styles.coinAmount}>
                <span>🟡</span> {pack.coins}
              </div>
              <div className={styles.coinPrice}>฿{pack.price}</div>
            </div>
          ))}
        </div>
      </section>

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
