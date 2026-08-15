'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MovieCard from '@/components/MovieCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { SkeletonPoster } from '@/components/ui/Skeleton';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { Movie } from '@/types';

// The page's Server Component already proved there was a session when the HTML
// was rendered; this only has to cope with it expiring afterwards (401 -> login).
export default function BookmarksClient() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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
  }, [router, retryCount]);

  const retry = () => {
    setError(null);
    setMovies(null);
    setRetryCount((count) => count + 1);
  };

  if (error) {
    return <ErrorPanel message={error} onRetry={retry} />;
  }

  // Distinguish "not loaded yet" (null) from "genuinely empty" ([]) — showing
  // the empty state while the request is still in flight would be another lie.
  if (movies === null) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonPoster key={i} />
        ))}
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <EmptyState
        icon="bookmark"
        title="ยังไม่มีเรื่องที่บันทึกไว้"
        description="แตะรูปบุ๊กมาร์กบนเรื่องที่สนใจ แล้วจะมาอยู่ที่นี่"
        action={{ label: 'ไปดูเรื่องแนะนำ', href: '/discover' }}
      />
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* Every item in this list is bookmarked by construction, so the badge
          reflects real state rather than "this happens to be the list". */}
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} size="fill" showBookmark />
      ))}
    </div>
  );
}
