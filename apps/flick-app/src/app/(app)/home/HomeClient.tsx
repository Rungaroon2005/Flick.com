'use client';

import Image from 'next/image';
import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import { ContinueWatchingItem, Movie } from '@/types';

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
    <main className="flex flex-col gap-6 pt-2">
      {/* Recommended Section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-5">
          <h2 className="text-lg font-bold text-fg">แนะนำ</h2>
          <Link href="/discover" className="text-sm font-medium text-fg-mute active:text-fg">
            ทั้งหมด &gt;
          </Link>
        </div>
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
          {recommendedMovies.map((movie) => (
            <div key={movie.id} className="snap-start">
              <MovieCard movie={movie} size="medium" />
            </div>
          ))}
        </div>
      </section>

      {/* Continue Watching — real incomplete watch history. Collapses
          entirely (no header, no empty row) when there is nothing to
          resume: an empty "continue" shelf is not a real section. */}
      {initialContinueWatching.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-5">
            <h2 className="text-lg font-bold text-fg">ดูต่อ</h2>
            <span className="text-sm font-medium text-fg-mute">ล่าสุด</span>
          </div>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            {initialContinueWatching.map((item) => {
              const totalSeconds = item.episode.durationMinutes * 60;
              const percentage =
                totalSeconds > 0
                  ? Math.min(100, Math.max(0, (item.progressSeconds / totalSeconds) * 100))
                  : 0;
              const artwork = item.episode.thumbnailUrl || item.movie.posterUrl;
              return (
                <Link
                  key={item.id}
                  href={`/player/${item.episode.id}`}
                  className="flex w-[190px] shrink-0 snap-start flex-col gap-1 text-[13px] text-fg"
                >
                  <span className="relative aspect-video w-full overflow-hidden rounded-md bg-ink-1">
                    {artwork && (
                      <Image src={artwork} alt="" fill sizes="190px" className="object-cover" />
                    )}
                    <span className="absolute inset-x-1.5 bottom-1.5 block h-[3px] overflow-hidden rounded-full bg-white/35">
                      <span className="block h-full bg-brand" style={{ width: `${percentage}%` }} />
                    </span>
                  </span>
                  <strong className="font-semibold">{item.movie.title}</strong>
                  <span className="text-fg-mute">ตอนที่ {item.episode.episodeNumber}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* My List Section — real bookmarks from GET /me/bookmarks. */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-5">
          <h2 className="text-lg font-bold text-fg">รายการของฉัน</h2>
          <Link href="/bookmarks" className="text-sm font-medium text-fg-mute active:text-fg">
            ทั้งหมด &gt;
          </Link>
        </div>
        {initialBookmarks.length > 0 ? (
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            {/* Every movie in this row is bookmarked by construction, so the
                badge reflects real state. */}
            {initialBookmarks.map((m) => (
              <div key={m.id} className="snap-start">
                <MovieCard movie={m} size="medium" showBookmark />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-fg-mute">ยังไม่มีเรื่องที่บันทึกไว้</p>
        )}
      </section>
    </main>
  );
}
