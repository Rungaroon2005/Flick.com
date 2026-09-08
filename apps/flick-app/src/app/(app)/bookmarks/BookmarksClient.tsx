'use client';

import { MovieCard } from '@/features/catalog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useWatchStatus } from '@/features/watchStatus';
import { Movie } from '@/types';

export default function BookmarksClient({ movies }: { movies: Movie[] }) {
  const watchStatus = useWatchStatus(movies.map((m) => m.id));

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
    <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
      {/* Every item in this list is bookmarked by construction, so the badge
          reflects real state rather than "this happens to be the list". */}
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} size="fill" showBookmark watchStatus={watchStatus[movie.id]} />
      ))}
    </div>
  );
}
