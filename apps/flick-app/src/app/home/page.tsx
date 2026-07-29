import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import HomeClient from './HomeClient';
import { Movie } from '@/types';
import styles from './page.module.css';

// Ensure NEXT_PUBLIC_API_URL is available
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function getMovies(): Promise<Movie[]> {
  const res = await fetch(`${API_URL}/movies`, {
    next: { revalidate: 60 }, // ISR: Revalidate every 60 seconds
  });
  
  if (!res.ok) {
    throw new Error('Failed to fetch movies');
  }
  
  return res.json();
}

export default async function HomePage() {
  let movies: Movie[] = [];
  let error: string | null = null;

  try {
    movies = await getMovies();
  } catch (err) {
    console.error('Error fetching movies on server:', err);
    error = 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง';
  }

  return (
    <div className={styles.container}>
      {/* Top Bar (Server rendered) */}
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

      {error ? (
        <div className={styles.loadingScreen}>
          <p>{error}</p>
        </div>
      ) : (
        <HomeClient initialMovies={movies} />
      )}

      <BottomNav />
    </div>
  );
}
