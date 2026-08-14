/* eslint-disable @next/next/no-img-element */
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import InfoModal from './InfoModal';
import styles from './page.module.css';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { Movie } from '@/types';

interface MovieClientProps {
  movie: Movie;
  similarMovies: Movie[];
  /** Server-resolved truth at render time; false for anonymous visitors. */
  initialBookmarked: boolean;
}

export default function MovieClient({ movie, similarMovies, initialBookmarked }: MovieClientProps) {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(false);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(
    movie.seasons && movie.seasons.length > 0 ? movie.seasons[0].seasonNumber : 1
  );
  const [downloadedEpisodeIds, setDownloadedEpisodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const currentSeason = movie.seasons?.find(s => s.seasonNumber === selectedSeason);
  const episodes = currentSeason?.episodes || [];
  const firstEpisode = movie.seasons?.flatMap((season) => season.episodes)[0];

  // Optimistic, with rollback: silently diverging from the server is worse than
  // a brief flicker. A 401 means the session expired — send them to log in
  // rather than showing a generic error.
  const toggleBookmark = async () => {
    const next = !bookmarked;
    setBookmarked(next);
    try {
      await apiFetch(`/me/bookmarks/${movie.id}`, { method: next ? 'PUT' : 'DELETE' });
    } catch (err) {
      setBookmarked(!next);
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    }
  };

  const addDownload = async (episodeId: string) => {
    setDownloadMessage(null);
    try {
      await apiFetch(`/me/downloads/${episodeId}`, { method: 'PUT' });
      setDownloadedEpisodeIds((current) => new Set(current).add(episodeId));
      setDownloadMessage('บันทึกรายการดาวน์โหลดแล้ว');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setDownloadMessage(
        err instanceof ApiError ? err.message : 'ไม่สามารถบันทึกรายการดาวน์โหลดได้',
      );
    }
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <button className={styles.closeBtn} onClick={() => router.back()} aria-label="Close">✕</button>
      </header>
      
      <div className={styles.heroSection}>
        <div className={styles.posterContainer}>
          <div className={styles.heroGradient}></div>
          {movie.posterUrl && (
             <img src={movie.posterUrl ?? undefined} alt={movie.title} className={styles.heroImage} />
          )}
          <div className={styles.heroContent}>
            <button className={styles.muteToggle} aria-label="Toggle mute">🔇</button>
          </div>
        </div>
      </div>
      
      <div className={styles.mainInfo}>
        <h1 className={styles.title}>{movie.title}</h1>
        <p className={styles.year}>{movie.year} • {movie.contentRating}</p>
        
        <div className={styles.actionBar}>
          <button
            className={styles.playButton}
            disabled={!firstEpisode}
            onClick={() => firstEpisode && router.push(`/player/${firstEpisode.id}`)}
          >
            ▶ เล่น
          </button>
          
          <div className={styles.actionIcons}>
            <div className={styles.actionItem}>
              <button className={styles.iconBtn} aria-label="Like">👍</button>
              <span>ชื่นชอบ</span>
            </div>
            <div className={styles.actionItem}>
              <button className={styles.iconBtn} aria-label="Share">📤</button>
              <span>แชร์</span>
            </div>
            <div className={styles.actionItem}>
              <button
                className={styles.iconBtn}
                onClick={toggleBookmark}
                aria-label="Bookmark"
                aria-pressed={bookmarked}
              >
                {bookmarked ? '🔖' : '➕'}
              </button>
              <span>บันทึก</span>
            </div>
            <div className={styles.actionItem}>
              <button
                className={styles.iconBtn}
                aria-label="ดาวน์โหลดตอนแรก"
                disabled={!firstEpisode}
                onClick={() => firstEpisode && addDownload(firstEpisode.id)}
              >
                ⬇️
              </button>
              <span>ดาวน์โหลด</span>
            </div>
          </div>
        </div>
        {downloadMessage && (
          <p className={styles.actionMessage} role="status">{downloadMessage}</p>
        )}
      </div>
      
      <div className={styles.descriptionSection}>
        <h2 className={styles.seasonTitle}>{movie.title} ซีซั่นที่ {selectedSeason}</h2>
        <p className={styles.descriptionText}>{movie.description}</p>
        <p className={styles.castText}>นักแสดง: เจมส์ จิรายุ, เบลล่า ราณี, ฯลฯ</p>
        <button className={styles.infoBtn} onClick={() => setShowInfo(true)}>ℹ ข้อมูลเพิ่มเติม</button>
      </div>
      
      <div className={styles.episodesContainer}>
        <div className={styles.seasonSelector}>
          <button 
            className={styles.dropdownBtn}
            onClick={() => setSeasonDropdownOpen(!seasonDropdownOpen)}
          >
            ซีซั่น {selectedSeason} ▼
          </button>
          <span className={styles.episodeCount}>{episodes.length} ตอน</span>
          
          {seasonDropdownOpen && (
            <div className={styles.dropdownMenu}>
              {movie.seasons?.map(s => (
                <div 
                  key={s.id} 
                  className={styles.dropdownItem}
                  onClick={() => {
                    setSelectedSeason(s.seasonNumber);
                    setSeasonDropdownOpen(false);
                  }}
                >
                  ซีซั่น {s.seasonNumber}
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className={styles.episodeList}>
          {episodes.map((ep) => (
            <div key={ep.id} className={`${styles.episodeItem} ${ep.coinCost > 0 ? styles.locked : ''}`}>
              <button
                className={styles.episodePlayTarget}
                onClick={() => router.push(`/player/${ep.id}`)}
                aria-label={`เล่น ${ep.title}`}
              >
                <span className={styles.epThumbnail}>
                  <img src={(ep.thumbnailUrl || movie.posterUrl) ?? undefined} alt="" />
                </span>
                <span className={styles.epInfo}>
                  <span className={styles.epTitle}>{ep.title}</span>
                  <span className={styles.epDuration}>{ep.durationMinutes} นาที</span>
                  <span className={styles.epDesc}>{ep.description}</span>
                </span>
              </button>
              <button
                className={styles.epAction}
                onClick={() => addDownload(ep.id)}
                aria-label={`ดาวน์โหลด ${ep.title}`}
              >
                {downloadedEpisodeIds.has(ep.id) ? '✓' : '⬇️'}
              </button>
            </div>
          ))}
        </div>
      </div>
      
      <div className={styles.similarSection}>
        <h3 className={styles.similarTitle}>รายการที่คล้ายกัน</h3>
        <div className={styles.similarScroll}>
          {similarMovies.slice(0, 5).map(m => (
            <div key={m.id} className={styles.similarItem} onClick={() => router.push(`/movie/${m.id}`)}>
              <img src={m.posterUrl ?? undefined} alt={m.title} />
            </div>
          ))}
        </div>
      </div>

      {showInfo && <InfoModal movie={movie} onClose={() => setShowInfo(false)} />}
    </>
  );
}
