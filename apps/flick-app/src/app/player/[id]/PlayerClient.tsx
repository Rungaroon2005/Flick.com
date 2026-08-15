'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import { useEntitlement } from './hooks/useEntitlement';
import { useHlsPlayer } from './hooks/useHlsPlayer';
import { useWatchProgress } from './hooks/useWatchProgress';
import { useMovieActions } from './hooks/useMovieActions';
import styles from './page.module.css';

/**
 * Composition-only: all state and side effects live in the four hooks this
 * pulls together (docs/FRONTEND_PLAN.md Phase 4 Step 1 — extracted with no
 * behavior change, verified against test/entitlement.e2e-spec.ts before any
 * markup below was touched). The player-shell rebuild (three-zone layout,
 * icon set, balance-branched gate sheet) is a separate, later commit.
 */
export default function PlayerClient({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  const {
    movie,
    episode,
    videoUrl,
    gate,
    error: entitlementError,
    gateError,
    unlocking,
    unlockWithCoins,
  } = useEntitlement(episodeId, router);

  const {
    isPlaying,
    setIsPlaying,
    mediaDuration,
    setMediaDuration,
    playbackRate,
    playbackError,
    setPlaybackError,
    fatalError,
    togglePlayback,
    changePlaybackRate,
    toggleFullscreen,
  } = useHlsPlayer(videoRef, episode, videoUrl);

  const { progressSeconds, setProgress, handleTimeUpdate, reportProgress } =
    useWatchProgress(episodeId, router, videoRef);

  const movieId = movie?.id ?? null;
  const {
    liked,
    bookmarked,
    movieActionsLoading,
    pendingAction,
    notice,
    toggleLike,
    toggleFavorite,
    addDownload,
  } = useMovieActions(movieId, episodeId, router);

  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeGate = useCallback(() => router.back(), [router]);
  const settingsDialogRef = useModalDismiss<HTMLDivElement>(
    closeSettings,
    showSettings,
  );
  const gateDialogRef = useModalDismiss<HTMLDivElement>(
    closeGate,
    gate !== null,
  );

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setProgress(seconds);
  };

  // Two independent hooks can each fail fatally (entitlement's own fetches,
  // or a fatal HLS.js/unsupported-browser condition); either blocks the
  // whole page the same way the original single `error` state did.
  const error = entitlementError ?? fatalError;

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

  if (!movie || !episode)
    return <div className={styles.loading}>กำลังโหลด…</div>;

  const durationSeconds = mediaDuration || episode.durationMinutes * 60;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => router.back()}
          aria-label="กลับ"
        >
          ←
        </button>
        <div className={styles.titleInfo}>
          <div className={styles.movieTitle}>{movie.title}</div>
          <div className={styles.episodeTitle}>{episode.title}</div>
        </div>
        <button
          className={styles.fullscreenBtn}
          onClick={toggleFullscreen}
          aria-label="เต็มหน้าจอ"
        >
          ⛶
        </button>
      </div>

      <div className={`${styles.videoArea} ${styles.videoAreaPortrait}`}>
        <video
          ref={videoRef}
          className={`${styles.videoElement} ${styles.videoElementPortrait}`}
          poster={movie.posterUrl ?? undefined}
          aria-label={`${movie.title} ${episode.title}`}
          playsInline
          preload="metadata"
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={(event) => {
            if (Number.isFinite(event.currentTarget.duration)) {
              setMediaDuration(event.currentTarget.duration);
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            void reportProgress(Math.floor(videoRef.current?.currentTime ?? 0));
          }}
          onError={() => setPlaybackError('เกิดข้อผิดพลาดในการเล่นวิดีโอ')}
        />
        <div className={styles.videoOverlay}>
          {!isPlaying && videoUrl && (
            <button
              className={styles.centerPlayBtn}
              onClick={togglePlayback}
              aria-label="เล่น"
            >
              ▶
            </button>
          )}
        </div>
      </div>

      <div className={styles.floatingActions}>
        <div className={styles.actionItem}>
          <button
            className={`${styles.iconBtn} ${liked ? styles.iconBtnActive : ''}`}
            aria-label={liked ? 'ยกเลิกถูกใจ' : 'ถูกใจ'}
            aria-pressed={liked}
            disabled={movieActionsLoading || pendingAction !== null}
            onClick={toggleLike}
          >
            {liked ? '♥' : '♡'}
          </button>
          <span>ถูกใจ</span>
        </div>
        <div className={styles.actionItem}>
          <button
            className={`${styles.iconBtn} ${bookmarked ? styles.iconBtnActive : ''}`}
            aria-label={bookmarked ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
            aria-pressed={bookmarked}
            disabled={movieActionsLoading || pendingAction !== null}
            onClick={toggleFavorite}
          >
            {bookmarked ? '★' : '☆'}
          </button>
          <span>รายการโปรด</span>
        </div>
        <div className={styles.actionItem}>
          <button
            className={styles.iconBtn}
            aria-label="ดาวน์โหลด"
            onClick={addDownload}
          >
            ⇩
          </button>
          <span>ดาวน์โหลด</span>
        </div>
      </div>

      {videoUrl && (
        <div className={styles.bottomControls}>
          <button
            className={styles.playPauseBtn}
            onClick={togglePlayback}
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
              onChange={(event) => seekTo(Number(event.target.value))}
              className={styles.progressBar}
              aria-label="ตำแหน่งการเล่น"
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
        <div className={styles.settingsOverlay} onClick={closeSettings}>
          <div
            ref={settingsDialogRef}
            className={styles.settingsPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.settingsHeader}>
              <h3 id="player-settings-title">การตั้งค่า</h3>
              <button
                className={styles.closeBtn}
                onClick={closeSettings}
                aria-label="ปิดการตั้งค่า"
                data-modal-close
              >
                ✕
              </button>
            </div>
            <div className={styles.settingGroup}>
              <h4>ความเร็ว</h4>
              <div className={styles.options}>
                {[0.75, 1, 1.25, 1.5].map((rate) => (
                  <button
                    type="button"
                    key={rate}
                    className={`${styles.option} ${playbackRate === rate ? styles.active : ''}`}
                    aria-pressed={playbackRate === rate}
                    onClick={() => changePlaybackRate(rate)}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {gate && (
        <div className={styles.subModalOverlay}>
          <div
            ref={gateDialogRef}
            className={styles.subModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-gate-title"
          >
            <h3 id="player-gate-title">
              {gate.reason === 'coins_required'
                ? 'ปลดล็อกตอนนี้'
                : 'สมัครสมาชิกเพื่อรับชม'}
            </h3>
            <p>
              {gate.reason === 'coins_required'
                ? `ตอนนี้ใช้ ${gate.coinCost} เหรียญ หรือรับชมด้วยสมาชิกพรีเมียม`
                : 'เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น'}
            </p>
            {gate.reason === 'coins_required' && (
              <button
                className={styles.subBtn}
                onClick={unlockWithCoins}
                disabled={unlocking}
              >
                {unlocking ? 'กำลังปลดล็อก…' : `ใช้ ${gate.coinCost} เหรียญ`}
              </button>
            )}
            <button
              className={styles.subBtn}
              onClick={() => router.push('/subscribe')}
            >
              ดูแพ็กเกจสมาชิก
            </button>
            <button
              className={styles.subCancel}
              onClick={closeGate}
              data-modal-close
            >
              กลับ
            </button>
            {gateError && (
              <p className={styles.gateMessage} role="status">
                {gateError}
              </p>
            )}
          </div>
        </div>
      )}

      {!gate && (playbackError || notice) && (
        <p className={styles.toast} role="status">
          {playbackError ?? notice}
        </p>
      )}
    </div>
  );
}
