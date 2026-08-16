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
    <main className="flex flex-col gap-10 pt-2 sm:gap-14">
      {/* Hero — a portrait showcase, not a VOD banner. The lead title's own
          poster doubles as an immersive blurred backdrop (there is no
          separate landscape key art in this catalogue — everything is
          portrait), and the play action lives inside the 9:16 card itself
          rather than a pair of pill buttons beside it. */}
      {featured && (
        <section className="relative -mt-2 overflow-hidden pb-2">
          <div className="absolute inset-0" aria-hidden="true">
            {featured.posterUrl && (
              <Image
                src={featured.posterUrl}
                alt=""
                fill
                sizes="100vw"
                className="scale-125 object-cover object-top blur-3xl brightness-[0.35] saturate-150"
              />
            )}
            <div
              className="absolute h-72 w-72 rounded-full bg-brand-ink/30 blur-[100px]"
              style={{ top: '-4%', left: '50%', transform: 'translateX(-50%)' }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-ink/10 via-ink/60 to-ink" />
          </div>

          <div className="relative flex flex-col items-center gap-4 px-5 pt-6 text-center">
            <span className="text-[11px] font-medium tracking-wide text-coin">แนะนำวันนี้</span>

            {featured.posterUrl && (
              <div className="relative aspect-[9/16] w-48 shrink-0 overflow-hidden rounded-[28px] ring-1 ring-white/15 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] sm:w-60 lg:w-72">
                <Image
                  src={featured.posterUrl}
                  alt={featured.title}
                  fill
                  priority
                  sizes="(max-width: 640px) 192px, (max-width: 1024px) 240px, 288px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

                <Link
                  href={featuredEpisodeId ? `/player/${featuredEpisodeId}` : `/movie/${featured.id}`}
                  aria-label={`เล่น ${featured.title}`}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className="animate-cta-pulse absolute h-16 w-16 rounded-full border border-brand-ink/70"
                    aria-hidden="true"
                  />
                  <span
                    className="animate-cta-pulse absolute h-16 w-16 rounded-full border border-brand-ink/70"
                    style={{ animationDelay: '1.1s' }}
                    aria-hidden="true"
                  />
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-brand/90 shadow-[0_0_32px_-4px_rgba(255,77,26,0.75)] backdrop-blur-xl transition-transform active:scale-90">
                    <Icon name="play" size={20} className="text-white" />
                  </span>
                </Link>
              </div>
            )}

            <div className="flex max-w-xs flex-col items-center gap-1.5">
              <h1 className="font-display text-2xl leading-tight font-extrabold text-fg [text-wrap:balance] sm:text-3xl">
                {featured.title}
              </h1>
              <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-fg-mute">
                <span>{featured.year}</span>
                {featured.genres.slice(0, 2).map((g) => (
                  <span key={g.id} className="before:mr-1.5 before:content-['·']">
                    {g.name}
                  </span>
                ))}
              </div>
              <Link
                href={`/movie/${featured.id}`}
                className="mt-1 text-sm text-fg-dim underline-offset-4 active:underline"
              >
                ข้อมูลเพิ่มเติม
              </Link>
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 sm:gap-14">
        {/* Recommended Section */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-5">
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-fg">แนะนำ</h2>
            <Link href="/discover" className="text-sm font-medium text-fg-mute active:text-fg">
              ทั้งหมด &gt;
            </Link>
          </div>
          <div className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [-webkit-overflow-scrolling:touch]">
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
              <h2 className="font-display text-2xl font-extrabold tracking-tight text-fg">ดูต่อ</h2>
              <span className="text-sm font-medium text-fg-mute">ล่าสุด</span>
            </div>
            <div className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [-webkit-overflow-scrolling:touch]">
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
                    className="group flex w-[190px] shrink-0 snap-start flex-col gap-1 text-[13px] text-fg"
                  >
                    <span className="relative aspect-video w-full overflow-hidden rounded-md bg-ink-1 shadow-[0_8px_20px_-10px_rgba(0,0,0,0.7)] transition-[transform,box-shadow] duration-250 [@media(hover:hover)]:group-hover:scale-105 [@media(hover:hover)]:group-hover:shadow-[0_18px_34px_-12px_rgba(0,0,0,0.85)]">
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
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-fg">รายการของฉัน</h2>
            <Link href="/bookmarks" className="text-sm font-medium text-fg-mute active:text-fg">
              ทั้งหมด &gt;
            </Link>
          </div>
          {initialBookmarks.length > 0 ? (
            <div className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 [-webkit-overflow-scrolling:touch]">
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
      </div>
    </main>
  );
}
