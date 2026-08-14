'use client';

import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import { Movie } from '@/types';
import styles from './page.module.css';

interface HomeClientProps {
  initialMovies: Movie[];
  /** This user's real bookmarks, fetched server-side (no-store) in page.tsx. */
  initialBookmarks: Movie[];
}

// Access control for this page now happens server-side in page.tsx
// (getSession() + redirect), so there is no login check to do here.
export default function HomeClient({ initialMovies, initialBookmarks }: HomeClientProps) {
  // Use recommended movies from API (just taking first 6 for demo)
  const recommendedMovies = initialMovies.slice(0, 6);

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
        {/* TODO(Task 3.4): populate from GET /me/watch-history. Until then this
            section reports the truth — nothing is known about what was watched. */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>ดูต่อ</h2>
            <Link href="/continue-watching" className={styles.seeAllLink}>ทั้งหมด &gt;</Link>
          </div>
          <div className={styles.emptyRow}>ยังไม่มีรายการที่ดูค้างไว้</div>
        </section>

        {/* My List Section — real bookmarks from GET /me/bookmarks. */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>รายการของฉัน</h2>
            <Link href="/bookmarks" className={styles.seeAllLink}>ทั้งหมด &gt;</Link>
          </div>
          {initialBookmarks.length > 0 ? (
            <div className={styles.horizontalScroll}>
              {/* Every movie in this row is bookmarked by construction, so the
                  badge reflects real state. */}
              {initialBookmarks.map((m) => (
                <MovieCard key={m.id} movie={m} size="medium" showBookmark />
              ))}
            </div>
          ) : (
            <div className={styles.emptyRow}>ยังไม่มีรายการที่บันทึกไว้</div>
          )}
        </section>
      </main>
    </>
  );
}
