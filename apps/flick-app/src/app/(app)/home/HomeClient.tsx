'use client';

import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import { ContinueWatchingItem, Movie } from '@/types';
import styles from './page.module.css';

interface HomeClientProps {
  initialMovies: Movie[];
  /** This user's real bookmarks, fetched server-side (no-store) in page.tsx. */
  initialBookmarks: Movie[];
  /** Incomplete watch-history rows, newest first, resolved by the API. */
  initialContinueWatching: ContinueWatchingItem[];
}

// Access control for this page now happens server-side in page.tsx
// (getSession() + redirect), so there is no login check to do here.
export default function HomeClient({
  initialMovies,
  initialBookmarks,
  initialContinueWatching,
}: HomeClientProps) {
  // Use the newest six real catalogue entries for the compact home row.
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

        {/* Continue Watching Section — real incomplete watch history. */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>ดูต่อ</h2>
            <span className={styles.seeAllLink}>ล่าสุด</span>
          </div>
          {initialContinueWatching.length > 0 ? (
            <div className={styles.horizontalScroll}>
              {initialContinueWatching.map((item) => {
                const totalSeconds = item.episode.durationMinutes * 60;
                const percentage = totalSeconds > 0
                  ? Math.min(100, Math.max(0, (item.progressSeconds / totalSeconds) * 100))
                  : 0;
                return (
                  <Link
                    key={item.id}
                    href={`/player/${item.episode.id}`}
                    className={styles.continueCard}
                  >
                    <span className={styles.continueArtwork}>
                      {(item.episode.thumbnailUrl || item.movie.posterUrl) && (
                        // The API supplies user-uploaded poster URLs; Task 4.5
                        // configures next/image hosts before these can migrate.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(item.episode.thumbnailUrl || item.movie.posterUrl) ?? undefined}
                          alt=""
                        />
                      )}
                      <span className={styles.continueProgressTrack}>
                        <span
                          className={styles.continueProgress}
                          style={{ width: `${percentage}%` }}
                        />
                      </span>
                    </span>
                    <strong>{item.movie.title}</strong>
                    <span>ตอนที่ {item.episode.episodeNumber}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyRow}>ยังไม่มีรายการที่ดูค้างไว้</div>
          )}
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
