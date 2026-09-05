import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

import { Movie, WatchStatusEntry } from '@/types';

interface MovieCardProps {
  movie: Movie;
  /** 'fill' stretches to the parent's width — for CSS grid cells (discover,
   *  search results) where the card's width is decided by the grid, not
   *  the card. */
  size?: 'small' | 'medium' | 'large' | 'fill';
  showBookmark?: boolean;
  /** From GET /me/watch-status, merged in client-side by the page (never
   *  server-rendered alongside the shared /movies cache -- design doc
   *  §2.1). Omitted entirely on pages that don't fetch it. */
  watchStatus?: WatchStatusEntry;
}

// Cards grow with the viewport rather than multiplying into a hairline row:
// a shelf should show ~1.5 cards on a phone and ~6 at desktop, not 12.
// Every width here is mirrored by the sizes hint below — change both or the
// browser serves an upscaled small rendition.
const sizeClasses = {
  small: 'w-[110px] md:w-[124px] xl:w-[136px]',
  medium: 'w-[140px] md:w-[160px] xl:w-[180px]',
  large: 'w-[160px] md:w-[184px] xl:w-[208px]',
  fill: 'w-full',
};

export default function MovieCard({
  movie,
  size = 'medium',
  showBookmark = false,
  watchStatus,
}: MovieCardProps) {
  if (!movie) return null;

  return (
    <Link
      href={`/movie/${movie.id}`}
      className={`focus-ring group relative block aspect-[2/3] shrink-0 overflow-hidden rounded-2xl bg-ink-1
        shadow-[0_8px_20px_-10px_rgba(0,0,0,0.7)]
        [-webkit-tap-highlight-color:transparent]
        transition-all duration-surface ease-enter
        [@media(hover:hover)]:hover:z-10 [@media(hover:hover)]:hover:[transform:var(--card-raise)] [@media(hover:hover)]:hover:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)]
        focus-visible:z-10 focus-visible:[transform:var(--card-raise)] focus-visible:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)]
        active:scale-95
        ${sizeClasses[size]}`}
    >
      <div className="relative h-full w-full">
        {/* No ViewTransition morph here: MovieCard is reused across rows
            that can render the same movie more than once on one page (a
            bookmarked movie appears in both "แนะนำ" and "รายการของฉัน" on
            /home). React's ViewTransition requires unique names among
            simultaneously-mounted instances — errors otherwise
            ("two <ViewTransition name=...> mounted at the same time"),
            found via the dev overlay while verifying Phase 6. The
            episode-thumbnail -> player morph doesn't have this problem
            (an episode renders at most once per page) and is kept. */}
        <Image
          src={movie.posterUrl || '/posters/sathu.jpg'}
          alt={movie.title || 'Movie'}
          fill
          sizes="(min-width: 1280px) 220px, (min-width: 1024px) 200px, (min-width: 768px) 184px, 160px"
          className="object-cover transition-[filter] duration-surface"
        />
        {showBookmark && (
          <div className="absolute top-2 right-2 z-[2] flex h-6 w-6 items-center justify-center rounded-full bg-brand text-ink shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
            <Icon name="bookmarkFilled" size={16} />
          </div>
        )}
        {watchStatus?.state === 'watched' && (
          <div className="absolute top-2 left-2 z-[2] flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-fg shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
            <Icon name="checkCircle" size={16} />
          </div>
        )}
        {watchStatus?.state === 'partial' && (
          <div className="absolute inset-x-0 bottom-0 z-[2] h-1 bg-black/40">
            <div
              data-testid="watch-progress"
              className="h-full bg-brand"
              style={{ width: `${watchStatus.percent}%` }}
            />
          </div>
        )}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/90 to-transparent
          px-2 pt-4 pb-2 transition-opacity duration-surface
          opacity-100 [@media(hover:hover)]:opacity-0
          [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:opacity-100"
      >
        {movie.title && (
          <span className="line-clamp-2 text-xs font-semibold text-fg [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
            {movie.title}
          </span>
        )}
      </div>
    </Link>
  );
}
