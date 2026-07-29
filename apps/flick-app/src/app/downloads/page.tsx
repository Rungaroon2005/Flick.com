/* eslint-disable @next/next/no-img-element */
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getDownloads } from '@/lib/auth';
import API_BASE_URL from '@/lib/api';
import BottomNav from '@/components/BottomNav';
import styles from './page.module.css';
import { Movie } from '@/types';

interface DownloadItem extends Partial<Movie> {
  epTitle: string;
  duration: string;
  desc: string;
}

export default function DownloadsPage() {
  const router = useRouter();
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/movies`)
      .then(res => res.json())
      .then((data: Movie[]) => {
        const downloadedMovies: DownloadItem[] = data.slice(0, 3).map((m: Movie) => ({
          ...m,
          epTitle: 'ตอนที่ 1',
          duration: '10 นาที',
          desc: 'เนื้อหา...'
        }));
        setDownloads(downloadedMovies);
      })
      .catch(err => {
        console.error(err);
        setError('ไม่สามารถโหลดรายการดาวน์โหลดได้');
      });
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <div className={styles.headerIcons}>
          <button className={styles.iconBtn} aria-label="Downloads">⬇️</button>
          <button className={styles.iconBtn} aria-label="Search">🔍</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>ดาวน์โหลดแล้ว</h1>
        
        {error ? (
          <div className={styles.emptyState}>
            <p>{error}</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', background: '#CC3300', color: '#fff', border: 'none', cursor: 'pointer' }}>ลองใหม่</button>
          </div>
        ) : downloads.length === 0 ? (
          <div className={styles.emptyState}>
            <p>ยังไม่มีรายการดาวน์โหลด</p>
          </div>
        ) : (
          <div className={styles.list}>
            {downloads.map((item, idx) => (
              <div key={idx} className={styles.downloadItem} onClick={() => router.push(`/movie/${item.id}`)}>
                <div className={styles.thumbnailContainer}>
                  <img src={item.posterUrl ?? undefined} alt={item.title} className={styles.thumbnail} />
                </div>
                <div className={styles.info}>
                  <h3 className={styles.title}>{item.title} - {item.epTitle}</h3>
                  <span className={styles.duration}>{item.duration}</span>
                  <p className={styles.desc}>{item.desc}</p>
                </div>
                <div className={styles.action}>
                  <span className={styles.checkIcon}>✓</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
