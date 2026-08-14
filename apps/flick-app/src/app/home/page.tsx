import Link from 'next/link';
import { redirect } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import HomeClient from './HomeClient';
import API_BASE_URL from '@/lib/api';
import { apiFetchServer, getSession } from '@/lib/session';
import { Movie } from '@/types';
import styles from './page.module.css';

async function getMovies(): Promise<Movie[]> {
  // Public catalogue data only — safe to share across users, unlike the session.
  const res = await fetch(`${API_BASE_URL}/movies`, {
    next: { revalidate: 60 }, // ISR: Revalidate every 60 seconds
  });
  
  if (!res.ok) {
    throw new Error('Failed to fetch movies');
  }
  
  return res.json();
}

export default async function HomePage() {
  // Authorisation happens here, on the server, before any of this page is sent.
  // redirect() throws, so nothing below runs for an unauthenticated request.
  const session = await getSession();
  if (!session) redirect('/login');

  let movies: Movie[] = [];
  let bookmarks: Movie[] = [];
  let error: string | null = null;

  try {
    // Public catalogue (ISR-cached) and this user's bookmarks (never cached)
    // in parallel. Past the redirect above the session is guaranteed, so a 401
    // here would be a genuine fault, not an anonymous visitor.
    [movies, bookmarks] = await Promise.all([
      getMovies(),
      apiFetchServer<Movie[]>('/me/bookmarks'),
    ]);
  } catch (err) {
    console.error('Error fetching movies on server:', err);
    error = 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง';
  }

  return (
    <div className={styles.container}>
      {/* Top Bar (Server rendered) */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>Flick</div>
          <span className={styles.greeting}>สวัสดี, {session.displayName}</span>
        </div>
        <div className={styles.headerIcons}>
          <Link href="/downloads" className={styles.iconButton}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </Link>
          <Link href="/search" className={styles.iconButton}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </Link>
        </div>
      </header>

      {error ? (
        <div className={styles.loadingScreen}>
          <p>{error}</p>
        </div>
      ) : (
        <HomeClient initialMovies={movies} initialBookmarks={bookmarks} />
      )}

      <BottomNav />
    </div>
  );
}
