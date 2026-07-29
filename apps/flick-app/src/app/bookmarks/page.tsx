'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBookmarks } from '@/lib/auth';
import API_BASE_URL from '@/lib/api';
import BottomNav from '@/components/BottomNav';
import styles from './page.module.css';
import { Movie } from '@/types';

export default function BookmarksPage() {
  const router = useRouter();
  const [bookmarks, setBookmarks] = useState<Movie[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/movies`)
      .then(res => res.json())
      .then((data: Movie[]) => {
        const bookmarkedIds = getBookmarks ? getBookmarks() : [];
        if (bookmarkedIds && bookmarkedIds.length > 0) {
          setBookmarks(data.filter((m: Movie) => bookmarkedIds.includes(m.id)));
        } else {
          setBookmarks(data.slice(0, 5)); // fallback demo
        }
      })
      .catch(err => {
        console.error(err);
        setError('ไม่สามารถโหลดรายการบันทึกได้');
      });
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <div className={styles.headerIcons}>
          <button className={styles.iconBtn}>⬇️</button>
          <button className={styles.iconBtn}>🔍</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>บันทึก</h1>
        
        {error ? (
          <div className={styles.emptyState}>
            <p>{error}</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', background: '#CC3300', color: '#fff', border: 'none', cursor: 'pointer' }}>ลองใหม่</button>
          </div>
        ) : bookmarks.length === 0 ? (
          <div className={styles.emptyState}>
            <p>ยังไม่มีรายการที่บันทึกไว้</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {bookmarks.map(movie => (
              <div key={movie.id} className={styles.movieCard} onClick={() => router.push(`/movie/${movie.id}`)}>
                <img src={movie.posterUrl ?? undefined} alt={movie.title} className={styles.thumbnail} />
                <div className={styles.bookmarkBadge}>🔖</div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
