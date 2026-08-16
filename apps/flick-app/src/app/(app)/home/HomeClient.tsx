'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ViewTransition } from 'react';
import MovieCard from '@/components/MovieCard';
import { Icon } from '@/components/ui/Icon';
import { ContinueWatchingItem, Movie } from '@/types';

interface HomeClientProps {
  initialMovies: Movie[];
  /** This user's real bookmarks, fetched server-side (no-store) in page.tsx. */
  initialBookmarks: Movie[];
  /** Incomplete watch-history rows, newest first, resolved by the API. */
  initialContinueWatching: ContinueWatchingItem[];
}

/** Same "sort episodes, take the first" rule DiscoverClient uses for its
 *  feed — episodeNumber is the only reliable ordering the API guarantees. */
function firstEpisodeId(movie: Movie): string | null {
  const episodes = movie.seasons?.flatMap((s) => s.episodes) ?? [];
  const first = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
  return first?.id ?? null;
}

// Access control for this page now happens server-side in page.tsx
// (getSession() + redirect), so there is no login check to do here.
export default function HomeClient({
  initialMovies,
  initialBookmarks,
  initialContinueWatching,
}: HomeClientProps) {
  // The catalogue's first entry anchors the hero; the recommended row picks
  // up right after it so nothing appears twice in the same screen.
  const featured = initialMovies[0];
  const recommendedMovies = initialMovies.slice(1, 7);
  const featuredEpisodeId = featured ? firstEpisodeId(featured) : null;

  return (
    <main className="flex flex-col gap-7 pt-2">
      {/* Hero — the catalogue's lead title. Posters here are portrait-only
          (this is a vertical-drama app; there is no landscape key art), so
          rather than stretch one into an ugly wide crop, the same image is
          blurred into a backdrop behind its own sharp, unstretched card. */}
      {featured && (
        <section className="relative -mt-2 overflow-hidden">
          <div className="absolute inset-0" aria-hidden="true">
            {featured.posterUrl && (
              <Image
                src={featured.posterUrl}
                alt=""
                fill
                sizes="100vw"
                className="scale-110 object-cover object-top blur-2xl brightness-[0.38] saturate-[1.15]"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/10 to-ink/40" />
          </div>
          <div className="relative flex gap-4 px-5 pt-5 pb-6">
            <div className="relative aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-xl shadow-[0_16px_32px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/10">
              {featured.posterUrl && (
                <Image
                  src={featured.posterUrl}
                  alt={featured.title}
                  fill
                  priority
                  sizes="112px"
                  className="object-cover"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-2">
              <span className="text-[11px] font-medium tracking-wide text-coin">แนะนำวันนี้</span>
              <h1 className="text-title font-display leading-tight text-fg [text-wrap:balance]">
                {featured.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-mute">
                <span>{featured.year}</span>
                {featured.genres.slice(0, 2).map((g) => (
                  <span key={g.id} className="before:mr-1.5 before:content-['·']">
                    {g.name}
                  </span>
                ))}
              </div>
              <div className="mt-1 flex gap-2">
                <Link
                  href={featuredEpisodeId ? `/player/${featuredEpisodeId}` : `/movie/${featured.id}`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-transform active:scale-95"
                >
                  <Icon name="play" size={13} />
                  ดูเลย
                </Link>
                <Link
                  href={`/movie/${featured.id}`}
                  className="inline-flex h-10 items-center rounded-lg bg-white/10 px-4 text-sm font-medium text-fg backdrop-blur-sm transition-transform active:scale-95"
                >
                  ข้อมูลเพิ่มเติม
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Recommended Section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-5">
          <h2 className="text-lg font-display font-bold text-fg">แนะนำ</h2>
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
                      <ViewTransition name={`episode-${item.episode.id}`}>
                        <Image src={artwork} alt="" fill sizes="190px" className="object-cover" />
                      </ViewTransition>
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
