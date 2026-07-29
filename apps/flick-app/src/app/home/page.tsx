'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import MovieCard from '@/components/MovieCard';
import API_BASE_URL from '@/lib/api';
import { isLoggedIn, getContinueWatching, getBookmarks } from '@/lib/auth';
import { Movie } from '@/types';
import styles from './page.module.css';

export default function HomePage() {
  const router = useRouter();
  const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
  const [bookmarks, setBookmarks] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);

  useEffect(() => {
    // Check if user is logged in
    const userLoggedIn = isLoggedIn();
    if (!userLoggedIn) {
      router.push('/login');
      return;
    }

    // Load data from API
    fetch(`${API_BASE_URL}/movies`)
      .then((res) => res.json())
      .then((data: Movie[]) => {
        setMovies(data);
        const cw = getContinueWatching() as { movieId: string }[];
        const cwMovies = cw.map(item => data.find(m => m.id === item.movieId)).filter((m): m is Movie => m !== undefined);
        setContinueWatching(cwMovies);

        const bms = getBookmarks() as string[];
        const bmMovies = bms.map(id => data.find(m => m.id === id)).filter((m): m is Movie => m !== undefined);
        setBookmarks(bmMovies);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Error fetching movies:', err);
        setError('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
        setIsLoading(false);
      });
  }, [router]);

  // Use recommended movies from API (just taking first 6 for demo)
  const recommendedMovies = movies.slice(0, 6);

  if (isLoading) {
    return <div className={styles.loadingScreen}>กำลังโหลด...</div>;
  }

  if (error) {
    return (
      <div className={styles.loadingScreen}>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', background: '#CC3300', color: '#fff', border: 'none', cursor: 'pointer' }}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
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

      <main className={styles.mainContent}>
        {/* Recommended Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>แนะนำ</h2>
            <Link href="/discover" className={styles.seeAllLink}>ทั้งหมด &gt;</Link>
          </div>
          <div className={styles.horizontalScroll}>
            {recommendedMovies.map(movie => (
              <MovieCard key={movie.id} movie={movie} size="medium" />
            ))}
          </div>
        </section>

        {/* Continue Watching Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>ดูต่อ</h2>
            <Link href="/continue-watching" className={styles.seeAllLink}>ทั้งหมด &gt;</Link>
          </div>
          <div className={styles.horizontalScroll}>
            {continueWatching.length > 0 ? (
              continueWatching.map(movie => (
                <MovieCard key={movie.id} movie={movie} size="medium" />
              ))
            ) : (
              <>
                <div className={styles.skeletonCard} />
                <div className={styles.skeletonCard} />
                <div className={styles.skeletonCard} />
              </>
            )}
          </div>
        </section>

        {/* My List Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>รายการของฉัน</h2>
            <Link href="/bookmarks" className={styles.seeAllLink}>ทั้งหมด &gt;</Link>
          </div>
          <div className={styles.horizontalScroll}>
            {bookmarks.length > 0 ? (
              bookmarks.map(movie => (
                <MovieCard key={movie.id} movie={movie} size="medium" showBookmark={true} />
              ))
            ) : (
              <>
                <div className={styles.skeletonCard} />
                <div className={styles.skeletonCard} />
                <div className={styles.skeletonCard} />
              </>
            )}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
