'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import API_BASE_URL from '@/lib/api';
import { hasActiveSubscription } from '@/lib/auth';
import styles from './page.module.css';
import { Movie } from '@/types';

export default function PlayerPage() {
  const router = useRouter();
  const { id } = useParams();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [subscriptionModal, setSubscriptionModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetch(`${API_BASE_URL}/movies/${id}`)
        .then(res => res.json())
        .then(data => setMovie(data))
        .catch(err => {
          console.error(err);
          setError('ไม่สามารถโหลดข้อมูลภาพยนตร์ได้');
        });
    }
    
    // Check subscription mock for a locked episode
    // Assuming episode 1 is locked for testing
    const isLocked = true; 
    // In a real app we would check actual episode cost
    // if (isLocked && !hasActiveSubscription()) {
    //   setSubscriptionModal(true);
    // }
  }, [id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setProgress(p => {
          if (p >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return p + 0.5;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  if (error) {
    return (
      <div className={styles.loading}>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', background: '#CC3300', color: '#fff', border: 'none', cursor: 'pointer' }}>ลองใหม่</button>
      </div>
    );
  }

  if (!movie) return <div className={styles.loading}>Loading...</div>;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()}>←</button>
        <div className={styles.titleInfo}>
          <div className={styles.movieTitle}>{movie.title}</div>
          <div className={styles.episodeTitle}>ตอนที่ 1</div>
        </div>
        <button className={styles.fullscreenBtn}>⛶</button>
      </div>

      {/* Video Area (Simulated) */}
      <div className={styles.videoArea}>
        <img src={movie.posterUrl ?? undefined} alt={movie.title} className={styles.videoBg} />
        <div className={styles.videoOverlay}>
          {!isPlaying && (
            <button className={styles.centerPlayBtn} onClick={() => setIsPlaying(true)}>
              ▶
            </button>
          )}
        </div>
      </div>

      {/* Floating Actions (Right) */}
      <div className={styles.floatingActions}>
        <div className={styles.actionItem}>
          <button className={styles.iconBtn}>👍</button>
          <span>ชื่นชอบ</span>
        </div>
        <div className={styles.actionItem}>
          <button className={styles.iconBtn}>🔖</button>
          <span>บันทึก</span>
        </div>
        <div className={styles.actionItem}>
          <button className={styles.iconBtn}>⬇️</button>
          <span>ดาวน์โหลด</span>
        </div>
        <div className={styles.actionItem}>
          <button className={styles.iconBtn}>📤</button>
          <span>แชร์</span>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className={styles.bottomControls}>
        <button className={styles.playPauseBtn} onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div className={styles.progressBarContainer}>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={progress} 
            onChange={(e) => setProgress(Number(e.target.value))}
            className={styles.progressBar}
          />
        </div>
        <button className={styles.settingsBtn} onClick={() => setShowSettings(true)}>
          ⚙️
        </button>
      </div>

      {/* Settings Overlay */}
      {showSettings && (
        <div className={styles.settingsOverlay} onClick={() => setShowSettings(false)}>
          <div className={styles.settingsPanel} onClick={e => e.stopPropagation()}>
            <div className={styles.settingsHeader}>
              <h3>การตั้งค่า</h3>
              <button className={styles.closeBtn} onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <div className={styles.settingGroup}>
              <h4>ความเร็ว</h4>
              <div className={styles.options}>
                <span className={styles.option}>0.5x</span>
                <span className={styles.option}>0.75x</span>
                <span className={`${styles.option} ${styles.active}`}>1x</span>
                <span className={styles.option}>1.25x</span>
                <span className={styles.option}>1.5x</span>
              </div>
            </div>
            <div className={styles.settingGroup}>
              <h4>ระบบเสียง</h4>
              <div className={styles.options}>
                <span className={`${styles.option} ${styles.active}`}>ไทย ✓</span>
                <span className={styles.option}>อังกฤษ</span>
                <span className={styles.option}>จีน</span>
              </div>
            </div>
            <div className={styles.settingGroup}>
              <h4>คำบรรยาย</h4>
              <div className={styles.options}>
                <span className={styles.option}>ไทย</span>
                <span className={`${styles.option} ${styles.active}`}>อังกฤษ ✓</span>
                <span className={styles.option}>จีน</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Guard Modal */}
      {subscriptionModal && (
        <div className={styles.subModalOverlay}>
          <div className={styles.subModal}>
            <h3>สมัครสมาชิกเพื่อรับชม</h3>
            <p>เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น</p>
            <button className={styles.subBtn} onClick={() => router.push('/subscribe')}>
              สมัครสมาชิก
            </button>
            <button className={styles.subCancel} onClick={() => router.back()}>
              กลับ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
