'use client';
import BottomNav from '@/components/BottomNav';
import styles from './page.module.css';

// TODO(Task 3.2): wire this page to GET /me/bookmarks (DB-backed, cookie-authenticated).
// The previous implementation read bookmarks from localStorage and, when empty,
// showed the first five movies in the catalogue as if the user had saved them.
// Both are gone; until 3.2 lands, the page reports the truth: nothing to show.
export default function BookmarksPage() {
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
        <h1 className={styles.pageTitle}>บันทึก</h1>

        <div className={styles.emptyState}>
          <p>ยังไม่มีรายการที่บันทึกไว้</p>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
