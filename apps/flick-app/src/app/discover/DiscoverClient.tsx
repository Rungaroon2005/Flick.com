'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import MovieCard from '@/components/MovieCard';
import { Movie } from '@/types';
import styles from './page.module.css';

interface DiscoverClientProps {
  initialMovies: Movie[];
}

const GENRES = [
  { label: 'ทั้งหมด', slug: null },
  { label: 'ดราม่า', slug: 'drama' },
  { label: 'ไซไฟ', slug: 'sci-fi' },
  { label: 'สยองขวัญ', slug: 'horror' },
  { label: 'อาชญากรรม', slug: 'crime' },
  { label: 'โรแมนติก', slug: 'romance' },
  { label: 'แอ็คชั่น', slug: 'action' },
] as const;

export default function DiscoverClient({ initialMovies }: DiscoverClientProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const filteredMovies = useMemo(
    () =>
      activeSlug === null
        ? initialMovies
        : initialMovies.filter((movie) =>
            movie.genres.some((g) => g.slug === activeSlug),
          ),
    [activeSlug, initialMovies],
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <div className={styles.headerIcons}>
          <Link href="/downloads" className={styles.iconButton}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </Link>
          <Link href="/search" className={styles.iconButton}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </Link>
        </div>
      </header>

      <main className={styles.mainContent}>
        <div className={styles.filterContainer}>
          <div className={styles.genreChips}>
            {GENRES.map(({ label, slug }) => (
              <button
                key={label}
                className={`${styles.chip} ${activeSlug === slug ? styles.activeChip : ''}`}
                onClick={() => setActiveSlug(slug)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.resultsContainer}>
          {filteredMovies.length > 0 ? (
            <div className={styles.grid}>
              {filteredMovies.map(movie => (
                <div key={movie.id} className={styles.gridItem}>
                  <MovieCard movie={movie} size="large" />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>ไม่พบภาพยนตร์ในหมวดหมู่นี้</p>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
