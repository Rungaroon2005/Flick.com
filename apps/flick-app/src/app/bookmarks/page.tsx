import { redirect } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import BookmarksClient from './BookmarksClient';
import { getSession } from '@/lib/session';
import styles from './page.module.css';

// GET /me/bookmarks always 401s without a session, and there is nothing
// legitimate to show an anonymous visitor here. Authorisation therefore happens
// on the server, before any of this page is sent — same shape as /home — rather
// than behind a client-side flash of "no bookmarks".
export default async function BookmarksPage() {
  const session = await getSession();
  if (!session) redirect('/login');

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
        <BookmarksClient />
      </main>

      <BottomNav />
    </div>
  );
}
