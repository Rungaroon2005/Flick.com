import Image from 'next/image';
import Link from 'next/link';
import styles from './MovieCard.module.css';

import { Movie } from '@/types';

interface MovieCardProps {
  movie: Movie;
  size?: 'small' | 'medium' | 'large';
  showBookmark?: boolean;
}

export default function MovieCard({ movie, size = 'medium', showBookmark = false }: MovieCardProps) {
  if (!movie) return null;

  return (
    <Link href={`/movie/${movie.id}`} className={`${styles.card} ${styles[size]}`}>
      <div className={styles.imageWrapper}>
        <Image
          src={movie.posterUrl || '/posters/sathu.jpg'}
          alt={movie.title || 'Movie'}
          fill
          sizes="(max-width: 480px) 160px, 200px"
          className={styles.image}
          unoptimized={true}
        />
        {showBookmark && (
          <div className={styles.bookmarkBadge}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
        )}
      </div>
      <div className={styles.overlay}>
        {movie.title && <span className={styles.title}>{movie.title}</span>}
      </div>
    </Link>
  );
}
