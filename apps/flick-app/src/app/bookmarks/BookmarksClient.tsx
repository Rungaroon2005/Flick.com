'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MovieCard from '@/components/MovieCard';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { Movie } from '@/types';
import styles from './page.module.css';

// The page's Server Component already proved there was a session when the HTML
// was rendered; this only has to cope with it expiring afterwards (401 -> login).
export default function BookmarksClient() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetch<Movie[]>('/me/bookmarks');
        if (!cancelled) setMovies(data);
      } catch (err) {
        if (cancelled) return;
        // A 401 means the session expired mid-session, not a generic failure.
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className={styles.emptyState}>
        <p>{error}</p>
      </div>
    );
  }

  // Distinguish "not loaded yet" (null) from "genuinely empty" ([]) — showing
  // the empty state while the request is still in flight would be another lie.
  if (movies === null) return null;

  if (movies.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>ยังไม่มีรายการที่บันทึกไว้</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {/* Every item in this list is bookmarked by construction, so the badge
          reflects real state rather than "this happens to be the list". */}
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} size="medium" showBookmark />
      ))}
    </div>
  );
}
