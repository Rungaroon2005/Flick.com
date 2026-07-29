'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MovieCard from '@/components/MovieCard';
import { isLoggedIn, getContinueWatching, getBookmarks } from '@/lib/auth';
import { Movie } from '@/types';
import styles from './page.module.css';

interface HomeClientProps {
  initialMovies: Movie[];
}

export default function HomeClient({ initialMovies }: HomeClientProps) {
  const router = useRouter();
  const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
  const [bookmarks, setBookmarks] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Check if user is logged in
    const userLoggedIn = isLoggedIn();
    if (!userLoggedIn) {
      router.push('/login');
      return;
    }

    const cw = getContinueWatching() as { movieId: string }[];
    const cwMovies = cw.map(item => initialMovies.find(m => m.id === item.movieId)).filter((m): m is Movie => m !== undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContinueWatching(cwMovies);

    const bms = getBookmarks() as string[];
    const bmMovies = bms.map(id => initialMovies.find(m => m.id === id)).filter((m): m is Movie => m !== undefined);
    setBookmarks(bmMovies);
    
    setIsLoading(false);
  }, [router, initialMovies]);

  // Use recommended movies from API (just taking first 6 for demo)
  const recommendedMovies = initialMovies.slice(0, 6);

  if (isLoading) {
    return <div className={styles.loadingScreen}>กำลังโหลด...</div>;
  }

  return (
    <>
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
    </>
  );
}
