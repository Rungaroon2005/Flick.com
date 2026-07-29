'use client';
import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import MovieCard from '@/components/MovieCard';
import API_BASE_URL from '@/lib/api';
import styles from './page.module.css';
import { Movie } from '@/types';

export default function SearchPage() {
  const [query, setQuery] = useState('');

  const [movies, setMovies] = useState<Movie[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/movies`)
      .then(res => res.json())
      .then(data => setMovies(data))
      .catch(err => {
        console.error(err);
        setError('ไม่สามารถโหลดข้อมูลได้');
      });
  }, []);

  const searchResults = useMemo(() => {
    if (!query.trim()) return movies;
    
    const lowerQuery = query.toLowerCase();
    return movies.filter(movie => 
      (movie.title && movie.title.toLowerCase().includes(lowerQuery)) ||
      (movie.genre && movie.genre.toLowerCase().includes(lowerQuery))
    );
  }, [query, movies]);

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
          <div className={styles.iconButtonActive}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
        </div>
      </header>

      <main className={styles.mainContent}>
        <div className={styles.searchContainer}>
          <div className={styles.searchBar}>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder="ค้นหาภาพยนตร์จีน, ภาพยนตร์ไทย..."
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className={styles.clearButton} onClick={() => setQuery('')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className={styles.resultsContainer}>
          {error ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>{error}</p>
              <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', background: '#CC3300', color: '#fff', border: 'none', cursor: 'pointer' }}>ลองใหม่</button>
            </div>
          ) : searchResults.length > 0 ? (
            <div className={styles.grid}>
              {searchResults.map(movie => (
                <div key={movie.id} className={styles.gridItem}>
                  <MovieCard movie={movie} size="small" />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>ไม่พบผลลัพธ์ที่ตรงกับ "{query}"</p>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
