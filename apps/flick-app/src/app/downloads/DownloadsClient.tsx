/* eslint-disable @next/next/no-img-element */
'use client';

import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import type { DownloadRecord } from '@/types';
import styles from './page.module.css';

export default function DownloadsClient({
  initialDownloads,
}: {
  initialDownloads: DownloadRecord[];
}) {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <div className={styles.headerIcons}>
          <span className={styles.currentIcon} aria-label="ดาวน์โหลด">⬇️</span>
          <Link className={styles.iconBtn} href="/search" aria-label="ค้นหา">🔍</Link>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>รายการดาวน์โหลด</h1>
        <p className={styles.disclaimer}>
          หน้านี้บันทึกรายการไว้ในบัญชี ยังไม่รองรับการรับชมแบบออฟไลน์
        </p>

        {initialDownloads.length === 0 ? (
          <div className={styles.emptyState}>
            <p>ยังไม่มีรายการดาวน์โหลด</p>
          </div>
        ) : (
          <div className={styles.list}>
            {initialDownloads.map((item) => (
              <Link
                href={`/player/${item.episode.id}`}
                className={styles.downloadItem}
                key={item.id}
              >
                <div className={styles.thumbnailContainer}>
                  {(item.episode.thumbnailUrl || item.movie.posterUrl) && (
                    <img
                      src={(item.episode.thumbnailUrl || item.movie.posterUrl) ?? undefined}
                      alt=""
                      className={styles.thumbnail}
                    />
                  )}
                </div>
                <div className={styles.info}>
                  <h2 className={styles.title}>{item.movie.title}</h2>
                  <span className={styles.duration}>
                    ตอนที่ {item.episode.episodeNumber} · {item.episode.durationMinutes} นาที
                  </span>
                  {item.episode.description && (
                    <p className={styles.desc}>{item.episode.description}</p>
                  )}
                </div>
                <span className={styles.action} aria-hidden="true">▶</span>
              </Link>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
