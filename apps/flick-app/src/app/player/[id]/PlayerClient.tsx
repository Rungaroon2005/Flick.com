'use client';

import { useCallback, useEffect, useRef, useState, ViewTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { ReactionButton } from '@/components/ui/ReactionButton';
import { apiFetch } from '@/lib/apiClient';
import { useEntitlement } from './hooks/useEntitlement';
import { useHlsPlayer } from './hooks/useHlsPlayer';
import { useWatchProgress } from './hooks/useWatchProgress';
import { useMovieActions } from './hooks/useMovieActions';

const CHROME_IDLE_MS = 2500;

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Three-zone portrait player (docs/FRONTEND_PLAN.md Part 2 / Phase 4 Step 3):
 * Zone A (header) and Zone B (transport) auto-hide after CHROME_IDLE_MS of
 * idle playback; Zone C (like/bookmark/download rail) persists while
 * playing — it's expressive, not navigational, and hiding it mid-scene
 * costs engagement. The rail anchors to the stage box itself
 * (aspect-[9/16], relative), not to viewport-unit arithmetic, so it stays
 * correct for any source aspect ratio.
 *
 * Composition and data flow are unchanged from Phase 4 Step 1 — this
 * commit only touches markup, layout, and the two new small additions
 * called out in useEntitlement (wallet balance, fetched here) and the
 * chrome-visibility state below (both pure presentation, no entitlement
 * logic moved).
 */
export default function PlayerClient({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);

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

  // Only fetch a balance when there's actually a coin gate to branch on —
  // not on every episode load.
  useEffect(() => {
    if (gate?.reason !== 'coins_required') return;
    let cancelled = false;
    apiFetch<{ balance: number }>('/wallet')
      .then((wallet) => {
        if (!cancelled) setBalance(wallet.balance);
      })
      .catch(() => {
        // The gate still works without a balance figure — it just can't
        // branch the copy, and falls back to the spend button.
      });
    return () => {
      cancelled = true;
    };
  }, [gate]);

  // Chrome (Zones A + B) hides after idle playback, stays locked visible
  // while paused, scrubbing, or the settings sheet is open. The "force
  // visible" reset lives in the cleanup — not the effect body — so it
  // fires when leaving the idle-hide condition (pause, scrub, sheet open,
  // or unmount) without calling setState synchronously in the effect.
  useEffect(() => {
    if (!isPlaying || showSettings || isScrubbing) return;
    const timer = window.setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    hideTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      setChromeVisible(true);
    };
  }, [isPlaying, showSettings, isScrubbing]);

  const recallChrome = () => {
    if (chromeVisible && isPlaying) {
      setChromeVisible(false);
      window.clearTimeout(hideTimerRef.current);
      return;
    }
    setChromeVisible(true);
  };

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setProgress(seconds);
  };

  const error = entitlementError ?? fatalError;

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-ink px-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Icon name="alertCircle" size={32} className="text-fail" />
          <p className="text-fg">{error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <Icon name="refresh" size={16} />
            ลองใหม่
          </Button>
        </div>
      </div>
    );
  }

  if (!movie || !episode) {
    return (
      <div className="flex h-dvh items-center justify-center bg-ink text-fg-dim">
        กำลังโหลด…
      </div>
    );
  }

  const durationSeconds = mediaDuration || episode.durationMinutes * 60;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink">
      {/* Ambient bleed — a static wash sampled from the poster fills the
          pillarbox instead of a flat gradient (Part 2). Never animated:
          movement here would compete with the scene. */}
      {movie.posterUrl && (
        <Image
          src={movie.posterUrl}
          alt=""
          fill
          className="scale-125 object-cover opacity-25 blur-3xl"
          aria-hidden="true"
        />
      )}

      {/* Zone A — chrome */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pt-safe pb-6 transition-opacity duration-200 ${
          chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <button
          onClick={() => router.back()}
          aria-label="กลับ"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-fg"
        >
          <Icon name="chevronLeft" size={26} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold text-fg">{movie.title}</div>
          <div className="truncate text-xs text-fg-dim">{episode.title}</div>
        </div>
        <button
          onClick={toggleFullscreen}
          aria-label="เต็มหน้าจอ"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-fg"
        >
          <Icon name="expand" size={20} />
        </button>
      </div>

      {/* Stage */}
      <div className="flex h-full items-center justify-center" onClick={recallChrome}>
        <div className="relative h-full max-w-full [aspect-ratio:9/16]">
          {/* Named to match the episode thumbnail in MovieClient/HomeClient
              — tapping an episode morphs into the stage instead of a hard
              cut (docs/FRONTEND_PLAN.md Part 4 Tier 2, the highest-value
              transition in the app). */}
          <ViewTransition name={`episode-${episode.id}`}>
            <video
              ref={videoRef}
              className="h-full w-full bg-black object-contain"
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
          </ViewTransition>

          {!isPlaying && videoUrl && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void togglePlayback();
                }}
                aria-label="เล่น"
                className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-black/50 text-white transition-transform active:scale-95"
              >
                <Icon name="play" size={26} className="ml-1" />
              </button>
            </div>
          )}

          {/* Zone C — rail, anchored to the stage. Persists while playing;
              like/bookmark/download are expressive, not navigational. */}
          <div className="absolute top-1/2 right-3 z-10 flex -translate-y-1/2 flex-col gap-5">
            <ReactionButton
              active={liked}
              icon="heart"
              activeIcon="heartFilled"
              label="ถูกใจ"
              activeLabel="ยกเลิกถูกใจ"
              disabled={movieActionsLoading || pendingAction !== null}
              showLabel
              onClick={(event) => {
                event.stopPropagation();
                void toggleLike();
              }}
            />
            <ReactionButton
              active={bookmarked}
              icon="bookmark"
              activeIcon="bookmarkFilled"
              label="รายการโปรด"
              activeLabel="นำออกจากรายการโปรด"
              disabled={movieActionsLoading || pendingAction !== null}
              showLabel
              onClick={(event) => {
                event.stopPropagation();
                void toggleFavorite();
              }}
            />
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void addDownload();
                }}
                aria-label="ดาวน์โหลด"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-md transition-[background-color] duration-150 active:scale-90 hover:bg-black/60"
              >
                <Icon name="download" size={20} />
              </button>
              <span className="text-xs text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">ดาวน์โหลด</span>
            </div>
          </div>
        </div>
      </div>

      {/* Zone B — transport */}
      {videoUrl && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-gradient-to-t from-black/90 to-transparent px-4 pt-10 pb-safe transition-opacity duration-200 ${
            chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <button
            onClick={() => void togglePlayback()}
            aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-white"
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={22} />
          </button>
          <span
            className={`shrink-0 text-data text-white transition-transform duration-150 ${isScrubbing ? 'scale-[1.15]' : ''}`}
          >
            {formatTime(progressSeconds)} / {formatTime(durationSeconds)}
          </span>
          <input
            type="range"
            min="0"
            max={durationSeconds}
            value={progressSeconds}
            onChange={(event) => seekTo(Number(event.target.value))}
            onPointerDown={() => setIsScrubbing(true)}
            onPointerUp={() => setIsScrubbing(false)}
            className="h-6 flex-1 accent-brand"
            aria-label="ตำแหน่งการเล่น"
          />
          <button
            onClick={() => setShowSettings(true)}
            aria-label="การตั้งค่า"
            className="flex h-11 w-11 shrink-0 items-center justify-center text-white"
          >
            <Icon name="settings" size={20} />
          </button>
        </div>
      )}

      <Sheet open={showSettings} onClose={closeSettings} title="การตั้งค่า">
        <div>
          <h4 className="mb-2 text-xs font-medium text-fg-dim">ความเร็ว</h4>
          <div className="flex flex-wrap gap-2">
            {[0.75, 1, 1.25, 1.5].map((rate) => (
              <button
                type="button"
                key={rate}
                aria-pressed={playbackRate === rate}
                onClick={() => changePlaybackRate(rate)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors
                  ${playbackRate === rate ? 'bg-brand text-white' : 'bg-ink-2 text-fg-dim'}`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Paywall gate — a sheet, not a centered modal: it reads as a drawer
          over content the user is still connected to (the poster stays
          visible behind it), which is also the actual sales argument
          (Part 3). Branches on balance for the coin-gated case; the
          subscription-required case still routes to /subscribe rather than
          inlining the plan comparison, which is a larger scope deferred
          past this pass. */}
      <Sheet
        open={gate !== null}
        onClose={closeGate}
        title={gate?.reason === 'coins_required' ? 'ปลดล็อกตอนนี้' : 'สมัครสมาชิกเพื่อรับชม'}
      >
        {gate?.reason === 'coins_required' ? (
          balance !== null && balance < gate.coinCost ? (
            <>
              <p className="text-sm text-fg-dim">
                เหรียญไม่พอ · มี {balance} จาก {gate.coinCost}
              </p>
              <Button variant="secondary" onClick={() => router.push('/discover')} className="mt-4 w-full">
                ดูตอนฟรี
              </Button>
              <Button variant="primary" onClick={() => router.push('/subscribe')} className="mt-2 w-full">
                ดูแพ็กเกจสมาชิก
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-dim">
                {balance !== null ? (
                  <>
                    <span className="text-data text-coin">◆ {balance}</span>
                    {' → '}
                    <span className="text-data text-coin">◆ {balance - gate.coinCost}</span>
                  </>
                ) : (
                  `ตอนนี้ใช้ ${gate.coinCost} เหรียญ`
                )}
              </p>
              <Button
                variant="primary"
                onClick={() => void unlockWithCoins()}
                loading={unlocking}
                className="mt-4 w-full"
              >
                {unlocking ? 'กำลังปลดล็อก…' : `ใช้ ${gate.coinCost} เหรียญ`}
              </Button>
              <Button variant="secondary" onClick={() => router.push('/subscribe')} className="mt-2 w-full">
                ดูแพ็กเกจสมาชิก
              </Button>
            </>
          )
        ) : (
          <>
            <p className="text-sm text-fg-dim">เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น</p>
            <Button variant="primary" onClick={() => router.push('/subscribe')} className="mt-4 w-full">
              ดูแพ็กเกจสมาชิก
            </Button>
          </>
        )}
        {gateError && (
          <p role="status" className="mt-3 text-center text-sm text-fg-dim">
            {gateError}
          </p>
        )}
      </Sheet>

      {!gate && (playbackError || notice) && (
        <p
          role="status"
          className="absolute inset-x-4 bottom-20 z-10 rounded-lg bg-black/80 px-4 py-3 text-center text-sm text-fg"
        >
          {playbackError ?? notice}
        </p>
      )}
    </div>
  );
}
