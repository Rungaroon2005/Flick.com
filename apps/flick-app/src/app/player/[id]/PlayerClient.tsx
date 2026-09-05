'use client';

import { useCallback, useEffect, useRef, useState, ViewTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { ReactionButton } from '@/components/ui/ReactionButton';
import { Switch } from '@/components/ui/Switch';
import {
  estimateFinishTime,
  formatClockTime,
  useEntitlement,
  useHlsPlayer,
  useMovieActions,
  useSleepTimer,
  useWatchProgress,
} from '@/features/playback';
import { usePreferences } from '@/features/preferences';
import { withNext } from '@/lib/nextParam';
import type { Episode, Movie, PlaybackAuthorization, SubscriptionPlan } from '@/types';

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
 * commit only touches markup, layout, and the chrome-visibility state
 * below (pure presentation, no entitlement logic moved).
 */
export default function PlayerClient({
  episodeId,
  initialMovie,
  initialEpisode,
  initialAuthorization,
  plans,
}: {
  episodeId: string;
  initialMovie: Movie;
  initialEpisode: Episode;
  initialAuthorization: PlaybackAuthorization;
  plans: SubscriptionPlan[];
}) {
  const router = useRouter();
  const { prefs, setNight } = usePreferences();
  // Every escape from the gate sheet carries this, so paying or subscribing
  // returns to the episode being sold rather than to the lobby.
  const returnPath = `/player/${episodeId}`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const {
    movie,
    episode,
    videoUrl,
    gate,
    error: entitlementError,
    gateError,
  } = useEntitlement(episodeId, router, initialMovie, initialEpisode, initialAuthorization);

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
  } = useHlsPlayer(videoRef, videoUrl);

  const { progressSeconds, setProgress, handleTimeUpdate, reportProgress } =
    useWatchProgress(episodeId, router, videoRef);

  // Separate React state, not a direct read of sleepPhase === 'expired':
  // that phase becomes true the instant the wall clock crosses the
  // deadline, before the flush below has even been issued. Gating the
  // dim overlay on THIS state instead means it can only render once the
  // flush has actually completed -- the ordering the design calls for,
  // enforced by sequencing rather than by two values happening to update
  // around the same time.
  const [sleepDimmed, setSleepDimmed] = useState(false);
  const handleSleepExpire = useCallback(async () => {
    await reportProgress(Math.floor(videoRef.current?.currentTime ?? 0));
    setSleepDimmed(true);
  }, [reportProgress]);
  const {
    phase: sleepPhase,
    mode: sleepMode,
    startTimer: startSleepTimer,
    startEndOfEpisode: startSleepEndOfEpisode,
    cancel: cancelSleep,
    notifyEpisodeEnded,
  } = useSleepTimer(videoRef, handleSleepExpire);

  const movieId = movie?.id ?? null;
  const {
    liked,
    bookmarked,
    movieActionsLoading,
    pendingAction,
    toggleLike,
    toggleFavorite,
    addDownload,
  } = useMovieActions(movieId, episodeId, router);

  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeGate = useCallback(() => router.back(), [router]);

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
    // Any interaction during the sleep warning cancels it outright, per
    // the design: a tap here means "I'm still here," and the countdown
    // has nothing further to prove.
    if (sleepPhase === 'warning' || sleepPhase === 'fading') {
      cancelSleep();
    }
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
  // Computed inline during render, never memoized: reading `new Date()`
  // fresh on every render is what makes this correct across a pause --
  // reopening the chrome after sitting paused for ten minutes must show a
  // finish time ten minutes later, not the value calculated when playback
  // began. estimateFinishTime's own behavior with respect to `now` is
  // covered directly in finishTime.test.ts.
  const skippableSeconds = episode.sceneMarkers.reduce(
    (total, m) => total + (m.endSeconds - m.startSeconds),
    0,
  );
  const { finishesAt, savedSeconds } = estimateFinishTime({
    now: new Date(),
    remainingSeconds: Math.max(0, durationSeconds - progressSeconds),
    skippableSeconds,
    autoSkip: prefs.autoSkip,
    playbackRate,
  });
  const savedMinutes = Math.round(savedSeconds / 60);

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
                notifyEpisodeEnded();
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
                className="flex h-16 w-16 items-center justify-center rounded-full border border-white/40 bg-black/50 text-white backdrop-blur-xl transition-all duration-surface ease-enter active:scale-90"
              >
                <Icon name="play" size={26} className="ml-1" />
              </button>
            </div>
          )}

          {/* Zone C — rail, anchored to the stage. Persists while playing;
              like/bookmark/download are expressive, not navigational. */}
          <div className="absolute top-1/2 right-3 z-10 flex -translate-y-1/2 flex-col gap-5 lg:right-auto lg:left-full lg:ml-6">
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
                aria-label="เก็บไว้ดูทีหลัง"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-xl transition-all duration-surface ease-enter active:scale-90 hover:bg-black/60"
              >
                <Icon name="download" size={20} />
              </button>
              <span className="text-xs text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">เก็บไว้</span>
            </div>
          </div>

          {/* Zone A — chrome */}
          <div
            onClick={(event) => event.stopPropagation()}
            className={`absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pt-safe pb-6 transition-opacity duration-surface ${
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
              <div className="truncate text-xs text-fg-mute">
                จบ {formatClockTime(finishesAt)}
                {prefs.autoSkip && savedMinutes > 0 && (
                  <> · ข้าม intro/credits แล้วเร็วขึ้น {savedMinutes} นาที</>
                )}
              </div>
            </div>
            <button
              onClick={toggleFullscreen}
              aria-label="เต็มหน้าจอ"
              className="flex h-11 w-11 shrink-0 items-center justify-center text-fg"
            >
              <Icon name="expand" size={20} />
            </button>
          </div>

          {/* Zone B — transport */}
          {videoUrl && (
            <div
              onClick={(event) => event.stopPropagation()}
              className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-gradient-to-t from-black/90 to-transparent px-4 pt-10 pb-safe transition-opacity duration-surface ${
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
                className={`shrink-0 text-data text-white transition-transform duration-ui ${isScrubbing ? 'scale-[1.15]' : ''}`}
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
        </div>
      </div>

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
                className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-surface ease-enter active:scale-95
                  ${playbackRate === rate ? 'bg-brand text-ink shadow-[0_0_16px_-3px_rgba(246,131,85,0.6)]' : 'bg-ink-2 text-fg-dim hover:bg-hairline'}`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-hairline pt-6">
          <div>
            <h4 className="text-xs font-medium text-fg-dim">โหมดกลางคืน</h4>
            <p className="mt-0.5 text-xs text-fg-mute">ลดความสว่างของหน้าจอ และปิดเล่นตอนถัดไปอัตโนมัติ</p>
          </div>
          <Switch checked={prefs.night} onChange={setNight} label="โหมดกลางคืน" />
        </div>

        <div className="mt-6 border-t border-hairline pt-6">
          <h4 className="mb-2 text-xs font-medium text-fg-dim">ตั้งเวลาปิด</h4>
          {sleepMode === null ? (
            <div className="flex flex-wrap gap-2">
              {[15, 30, 60].map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  onClick={() => startSleepTimer(minutes)}
                  className="rounded-full bg-ink-2 px-4 py-2.5 text-sm font-medium text-fg-dim transition-all duration-surface ease-enter hover:bg-hairline active:scale-95"
                >
                  {minutes} นาที
                </button>
              ))}
              <button
                type="button"
                onClick={startSleepEndOfEpisode}
                className="rounded-full bg-ink-2 px-4 py-2.5 text-sm font-medium text-fg-dim transition-all duration-surface ease-enter hover:bg-hairline active:scale-95"
              >
                จบตอนนี้
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-ink-2 px-4 py-3">
              <span className="text-sm text-fg">
                {sleepMode === 'end-of-episode' ? 'จะหยุดเมื่อจบตอนนี้' : 'ตั้งเวลาปิดอยู่'}
              </span>
              <button
                type="button"
                onClick={cancelSleep}
                className="focus-ring text-sm font-medium text-brand-ink"
              >
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      </Sheet>

      {/* Paywall gate — a sheet, not a centered modal: it reads as a drawer
          over content the user is still connected to (the poster stays
          visible behind it), which is also the actual sales argument
          (Part 3). */}
      <Sheet open={gate !== null} onClose={closeGate} title="สมัครสมาชิกเพื่อรับชม">
        <p className="text-sm text-fg-dim">เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น</p>
        {plans.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="flex items-baseline justify-between rounded-xl border border-white/10 bg-ink-2 px-4 py-3"
              >
                <span className="text-sm font-medium text-fg">{plan.name}</span>
                <span className="text-data text-fg-dim">
                  ฿{plan.price}
                  {plan.period}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="primary"
          onClick={() => router.push(withNext('/subscribe', returnPath))}
          className="mt-4 w-full"
        >
          ดูแพ็กเกจสมาชิก
        </Button>
        {gateError && (
          <p role="status" className="mt-3 text-center text-sm text-fg-dim">
            {gateError}
          </p>
        )}
      </Sheet>

      {!gate && playbackError && (
        <p
          role="status"
          className="absolute inset-x-4 bottom-20 z-10 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-center text-sm text-fg backdrop-blur-xl"
        >
          {playbackError}
        </p>
      )}

      {/* One card for both 'warning' and 'fading' -- the volume ramp inside
          'fading' is audible on its own, so the card doesn't need a second
          message to announce it. A tap anywhere on the stage (recallChrome)
          also cancels; this is just the visible, focusable target that
          names what's about to happen.

          role="alert" sits on the wrapping div, not the button: ARIA roles
          override an element's NATIVE accessible role, so putting it
          directly on the <button> would replace its "button" semantics
          with "alert" and could tell assistive tech this isn't
          interactive, even though it still visually responds to clicks.
          A live region announces on insertion regardless of which element
          in the subtree carries the text, so the button keeps its real
          role and the card still gets announced. */}
      {!gate && (sleepPhase === 'warning' || sleepPhase === 'fading') && (
        <div role="alert" className="absolute inset-x-4 bottom-20 z-30">
          <button
            type="button"
            onClick={cancelSleep}
            className="focus-ring w-full rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-center text-sm text-fg backdrop-blur-xl"
          >
            จะหยุดใน 1 นาที · แตะเพื่อดูต่อ
          </button>
        </div>
      )}

      {/* The sleep timer's own expiry, separate from the paywall gate: dims
          the whole player, not just the video box, and only once progress
          has actually been flushed (sleepDimmed, not sleepPhase directly --
          see where it's set above). */}
      {sleepDimmed && (
        <div
          role="status"
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/90 text-center"
        >
          <p className="text-sm text-fg-dim">หยุดชั่วคราวเพราะถึงเวลานอนแล้ว</p>
          <button
            type="button"
            onClick={() => {
              setSleepDimmed(false);
              cancelSleep();
              void togglePlayback();
            }}
            className="focus-ring rounded-full bg-brand px-6 py-3 text-sm font-medium text-ink"
          >
            แตะเพื่อดูต่อ
          </button>
        </div>
      )}
    </div>
  );
}
