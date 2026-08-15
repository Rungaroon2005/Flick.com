import Image from 'next/image';
import Link from 'next/link';
import { Icon } from './ui/Icon';

import { Movie } from '@/types';

interface MovieCardProps {
  movie: Movie;
  size?: 'small' | 'medium' | 'large';
  showBookmark?: boolean;
}

const sizeClasses = {
  small: 'w-[110px]',
  medium: 'w-[140px]',
  large: 'w-[160px]',
};

export default function MovieCard({ movie, size = 'medium', showBookmark = false }: MovieCardProps) {
  if (!movie) return null;

  return (
    <Link
      href={`/movie/${movie.id}`}
      className={`group relative block aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-ink-1
        [-webkit-tap-highlight-color:transparent]
        transition-transform duration-250
        [@media(hover:hover)]:hover:z-10 [@media(hover:hover)]:hover:scale-105
        active:scale-[0.98]
        ${sizeClasses[size]}`}
    >
      <div className="relative h-full w-full">
        <Image
          src={movie.posterUrl || '/posters/sathu.jpg'}
          alt={movie.title || 'Movie'}
          fill
          sizes="(max-width: 480px) 160px, 200px"
          className="object-cover transition-[filter] duration-250"
        />
        {showBookmark && (
          <div className="absolute top-2 right-2 z-[2] flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
            <Icon name="bookmarkFilled" size={16} />
          </div>
        )}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/90 to-transparent
          px-2 pt-4 pb-2 opacity-0 transition-opacity duration-250
          [@media(hover:hover)]:group-hover:opacity-100"
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
