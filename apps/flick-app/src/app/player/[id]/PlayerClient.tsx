/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';
import type { Episode, Movie, PlaybackAuthorization } from '@/types';
import styles from './page.module.css';

type DeniedAuthorization = Extract<PlaybackAuthorization, { allowed: false }>;

function findEpisode(movies: Movie[], episodeId: string) {
  for (const movie of movies) {
    for (const season of movie.seasons ?? []) {
      const episode = season.episodes.find((item) => item.id === episodeId);
      if (episode) return { movie, episode };
    }
  }
  return null;
}

export default function PlayerClient({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [gate, setGate] = useState<DeniedAuthorization | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressSeconds, setProgressSeconds] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const progressRef = useRef(0);
  const lastReportedRef = useRef(0);

  // Public catalogue metadata deliberately remains a separate request from
  // entitlement. It never contains videoUrl, and a metadata fault cannot turn
  // into an authorization grant.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const movies = await apiFetch<Movie[]>('/movies');
        const result = findEpisode(movies, episodeId);
        if (cancelled) return;
        if (!result) {
          setError('ไม่พบตอนนี้');
          return;
        }
        setMovie(result.movie);
        setEpisode(result.episode);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError('ไม่สามารถโหลดข้อมูลตอนนี้ได้');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId, router]);

  const applyAuthorization = useCallback((auth: PlaybackAuthorization) => {
    if (auth.allowed) {
      setVideoUrl(auth.videoUrl);
      setGate(null);
      setGateError(null);
    } else {
      setVideoUrl(null);
      setIsPlaying(false);
      setGate(auth);
    }
  }, []);

  // The server is the only entitlement authority. The cancellation guard is
  // load-bearing: route changes must not let a late response mutate this page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const auth = await apiFetch<PlaybackAuthorization>(
          `/playback/${episodeId}/authorize`,
        );
        if (!cancelled) applyAuthorization(auth);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'ไม่สามารถตรวจสอบสิทธิ์การรับชมได้');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAuthorization, episodeId, router]);

  const reportProgress = useCallback(
    async (seconds: number) => {
      if (seconds <= 0 || seconds === lastReportedRef.current) return;
      try {
        await apiFetch(`/me/watch-history/${episodeId}`, {
          method: 'PUT',
          keepalive: true,
          body: JSON.stringify({ progressSeconds: seconds }),
        });
        lastReportedRef.current = seconds;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
      }
    },
    [episodeId, router],
  );

  useEffect(() => {
    if (!isPlaying || !videoUrl || !episode) return;
    const durationSeconds = episode.durationMinutes * 60;
    const interval = window.setInterval(() => {
      setProgressSeconds((current) => Math.min(durationSeconds, current + 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [episode, isPlaying, videoUrl]);

  useEffect(() => {
    progressRef.current = progressSeconds;
    if (progressSeconds > 0 && progressSeconds % 10 === 0) {
      void reportProgress(progressSeconds);
    }
  }, [progressSeconds, reportProgress]);

  useEffect(
    () => () => {
      void reportProgress(progressRef.current);
    },
    [reportProgress],
  );

  const unlockWithCoins = async () => {
    setUnlocking(true);
    setGateError(null);
    try {
      await apiFetch('/wallet/spend', {
        method: 'POST',
        body: JSON.stringify({ episodeId }),
      });
      // Never grant optimistically after a spend: ask the authority again.
      const auth = await apiFetch<PlaybackAuthorization>(
        `/playback/${episodeId}/authorize`,
      );
      applyAuthorization(auth);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setGateError(err instanceof ApiError ? err.message : 'ไม่สามารถปลดล็อกตอนนี้ได้');
    } finally {
      setUnlocking(false);
    }
  };

  const addDownload = async () => {
    setGateError(null);
    try {
      await apiFetch(`/me/downloads/${episodeId}`, { method: 'PUT' });
      setGateError('บันทึกรายการดาวน์โหลดแล้ว');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setGateError(err instanceof ApiError ? err.message : 'ไม่สามารถบันทึกรายการดาวน์โหลดได้');
    }
  };

  if (error) {
    return (
      <div className={styles.loading}>
        <div className={styles.errorPanel}>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>ลองใหม่</button>
        </div>
      </div>
    );
  }

  if (!movie || !episode) return <div className={styles.loading}>กำลังโหลด…</div>;

  const durationSeconds = episode.durationMinutes * 60;
  const progressPercent = durationSeconds > 0
    ? Math.min(100, (progressSeconds / durationSeconds) * 100)
    : 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()} aria-label="กลับ">←</button>
        <div className={styles.titleInfo}>
          <div className={styles.movieTitle}>{movie.title}</div>
          <div className={styles.episodeTitle}>{episode.title}</div>
        </div>
        <button className={styles.fullscreenBtn} aria-label="เต็มหน้าจอ">⛶</button>
      </div>

      <div className={styles.videoArea}>
        {(episode.thumbnailUrl || movie.posterUrl) && (
          <img
            src={(episode.thumbnailUrl || movie.posterUrl) ?? undefined}
            alt=""
            className={styles.videoBg}
          />
        )}
        <div className={styles.videoOverlay}>
          {!isPlaying && videoUrl && (
            <button
              className={styles.centerPlayBtn}
              onClick={() => setIsPlaying(true)}
              aria-label="เล่น"
            >
              ▶
            </button>
          )}
        </div>
      </div>

      <div className={styles.floatingActions}>
        <div className={styles.actionItem}>
          <button className={styles.iconBtn} aria-label="ดาวน์โหลด" onClick={addDownload}>⬇️</button>
          <span>ดาวน์โหลด</span>
        </div>
      </div>

      {videoUrl && (
        <div className={styles.bottomControls}>
          <button
            className={styles.playPauseBtn}
            onClick={() => setIsPlaying((current) => !current)}
            aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <div className={styles.progressBarContainer}>
            <input
              type="range"
              min="0"
              max={durationSeconds}
              value={progressSeconds}
              onChange={(event) => setProgressSeconds(Number(event.target.value))}
              className={styles.progressBar}
              aria-label="ตำแหน่งการเล่น"
              style={{ '--player-progress': `${progressPercent}%` } as React.CSSProperties}
            />
          </div>
          <button
            className={styles.settingsBtn}
            onClick={() => setShowSettings(true)}
            aria-label="การตั้งค่า"
          >
            ⚙️
          </button>
        </div>
      )}

      {showSettings && (
        <div className={styles.settingsOverlay} onClick={() => setShowSettings(false)}>
          <div className={styles.settingsPanel} onClick={(event) => event.stopPropagation()}>
            <div className={styles.settingsHeader}>
              <h3>การตั้งค่า</h3>
              <button className={styles.closeBtn} onClick={() => setShowSettings(false)} aria-label="ปิดการตั้งค่า">✕</button>
            </div>
            <div className={styles.settingGroup}>
              <h4>ความเร็ว</h4>
              <div className={styles.options}>
                <span className={`${styles.option} ${styles.active}`}>1x</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {gate && (
        <div className={styles.subModalOverlay}>
          <div className={styles.subModal} role="dialog" aria-modal="true" aria-labelledby="player-gate-title">
            <h3 id="player-gate-title">
              {gate.reason === 'coins_required' ? 'ปลดล็อกตอนนี้' : 'สมัครสมาชิกเพื่อรับชม'}
            </h3>
            <p>
              {gate.reason === 'coins_required'
                ? `ตอนนี้ใช้ ${gate.coinCost} เหรียญ หรือรับชมด้วยสมาชิกพรีเมียม`
                : 'เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น'}
            </p>
            {gate.reason === 'coins_required' && (
              <button className={styles.subBtn} onClick={unlockWithCoins} disabled={unlocking}>
                {unlocking ? 'กำลังปลดล็อก…' : `ใช้ ${gate.coinCost} เหรียญ`}
              </button>
            )}
            <button className={styles.subBtn} onClick={() => router.push('/subscribe')}>
              ดูแพ็กเกจสมาชิก
            </button>
            <button className={styles.subCancel} onClick={() => router.back()}>
              กลับ
            </button>
            {gateError && <p className={styles.gateMessage} role="status">{gateError}</p>}
          </div>
        </div>
      )}

      {!gate && gateError && <p className={styles.toast} role="status">{gateError}</p>}
    </div>
  );
}
