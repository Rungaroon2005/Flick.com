'use client';
import BottomNav from '@/components/BottomNav';
import styles from './page.module.css';

// TODO(Task 3.4): wire this page to GET /me/downloads (DB-backed, cookie-authenticated).
// The previous implementation listed the first three movies in the catalogue with
// invented episode titles and durations, as if they had been downloaded. Removed
// rather than kept: an empty list is honest, a fabricated one is not.
export default function DownloadsPage() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <div className={styles.headerIcons}>
          <button className={styles.iconBtn} aria-label="Downloads">⬇️</button>
          <button className={styles.iconBtn} aria-label="Search">🔍</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>ดาวน์โหลดแล้ว</h1>

        <div className={styles.emptyState}>
          <p>ยังไม่มีรายการดาวน์โหลด</p>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
