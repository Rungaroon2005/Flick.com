'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import API_BASE_URL from '@/lib/api';
import InfoModal from './InfoModal';
import styles from './page.module.css';
import { Movie } from '@/types';

export default function MovieDetail() {
  const router = useRouter();
  const { id } = useParams();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(1);
  
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetch(`${API_BASE_URL}/movies/${id}`)
        .then(res => res.json())
        .then(data => {
          setMovie(data);
          if (data.seasons && data.seasons.length > 0) {
            setSelectedSeason(data.seasons[0].seasonNumber);
          }
        })
        .catch(err => {
          console.error(err);
          setError('ไม่สามารถโหลดข้อมูลภาพยนตร์ได้');
        });

      fetch(`${API_BASE_URL}/movies`)
        .then(res => res.json())
        .then(data => setSimilarMovies(data.filter((m: Movie) => m.id !== id)))
        .catch(err => console.error(err));
    }
  }, [id]);

  if (error) {
    return (
      <div className={styles.loading}>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', background: '#CC3300', color: '#fff', border: 'none', cursor: 'pointer' }}>ลองใหม่</button>
      </div>
    );
  }

  if (!movie) {
    return <div className={styles.loading}>Loading...</div>;
  }

  const currentSeason = movie.seasons?.find(s => s.seasonNumber === selectedSeason);
  const episodes = currentSeason?.episodes || [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>F</div>
        <button className={styles.closeBtn} onClick={() => router.back()}>✕</button>
      </header>
      
      <div className={styles.heroSection}>
        <div className={styles.posterContainer}>
          <div className={styles.heroGradient}></div>
          {movie.posterUrl && (
             <img src={movie.posterUrl ?? undefined} alt={movie.title} className={styles.heroImage} />
          )}
          <div className={styles.heroContent}>
            <button className={styles.muteToggle}>🔇</button>
          </div>
        </div>
      </div>
      
      <div className={styles.mainInfo}>
        <h1 className={styles.title}>{movie.title}</h1>
        <p className={styles.year}>{movie.year || '2024'} • {movie.genre || 'Action'}</p>
        
        <div className={styles.actionBar}>
          <button className={styles.playButton} onClick={() => router.push(`/player/${movie.id}`)}>
            ▶ เล่น
          </button>
          
          <div className={styles.actionIcons}>
            <div className={styles.actionItem}>
              <button className={styles.iconBtn}>👍</button>
              <span>ชื่นชอบ</span>
            </div>
            <div className={styles.actionItem}>
              <button className={styles.iconBtn}>📤</button>
              <span>แชร์</span>
            </div>
            <div className={styles.actionItem}>
              <button className={styles.iconBtn}>🔖</button>
              <span>บันทึก</span>
            </div>
            <div className={styles.actionItem}>
              <button className={styles.iconBtn}>⬇️</button>
              <span>ดาวน์โหลด</span>
            </div>
          </div>
        </div>
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
              <div className={styles.epThumbnail}>
                <img src={(ep.thumbnailUrl || movie.posterUrl) ?? undefined} alt={ep.title} />
              </div>
              <div className={styles.epInfo}>
                <h4 className={styles.epTitle}>{ep.title}</h4>
                <span className={styles.epDuration}>{ep.durationMinutes} นาที</span>
                <p className={styles.epDesc}>{ep.description}</p>
              </div>
              <div className={styles.epAction}>
                {ep.coinCost === 0 ? '✓' : '⬇️'}
              </div>
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
    </div>
  );
}
