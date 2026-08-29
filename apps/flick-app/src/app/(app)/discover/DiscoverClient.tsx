'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { ReactionButton } from '@/components/ui/ReactionButton';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { AppHeader } from '@/components/ui/AppHeader';
import {
  useHlsPlayer,
  useMovieActions,
  usePlaybackAuthorization,
  useWatchProgress,
} from '@/features/playback';
import type { Movie } from '@/types';

interface DiscoverClientProps {
  initialMovies: Movie[];
}

const GENRES = [
  { label: 'ทั้งหมด', slug: null },
  { label: 'ดราม่า', slug: 'drama' },
  { label: 'ไซไฟ', slug: 'sci-fi' },
  { label: 'สยองขวัญ', slug: 'horror' },
  { label: 'อาชญากรรม', slug: 'crime' },
  { label: 'โรแมนติก', slug: 'romance' },
  { label: 'แอ็คชั่น', slug: 'action' },
] as const;

const SWIPE_THRESHOLD = 96;

interface FeedItem {
  movie: Movie;
  episodeId: string;
}

/**
 * TikTok-style vertical feed: one movie's first episode per full-screen
 * slide, snap-scroll to advance, swipe right to open /movie/[id]. Replaces
 * the old poster-grid /discover (user request, 2026-08-16) — the grid
 * itself is gone; genre filtering survives as a glass overlay row.
 */
export default function DiscoverClient({ initialMovies }: DiscoverClientProps) {
  const router = useRouter();
  const feedRef = useRef<HTMLDivElement>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [visibleEpisodeId, setVisibleEpisodeId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const activeGenreLabel = GENRES.find((g) => g.slug === activeSlug)?.label;

  const items: FeedItem[] = useMemo(() => {
    const filtered =
      activeSlug === null
        ? initialMovies
        : initialMovies.filter((movie) => movie.genres.some((g) => g.slug === activeSlug));

    return filtered.flatMap((movie) => {
      const episodes = movie.seasons?.flatMap((s) => s.episodes) ?? [];
      const first = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
      return first ? [{ movie, episodeId: first.id }] : [];
    });
  }, [activeSlug, initialMovies]);

  const activeEpisodeId = items.some((item) => item.episodeId === visibleEpisodeId)
    ? visibleEpisodeId
    : (items[0]?.episodeId ?? null);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;

    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const episodeId = (entry.target as HTMLElement).dataset.episodeId;
          if (episodeId) ratios.set(episodeId, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        const nextActive = [...ratios.entries()].sort((a, b) => b[1] - a[1])[0];
        if (nextActive && nextActive[1] >= 0.6) setVisibleEpisodeId(nextActive[0]);
      },
      { root: feed, threshold: [0, 0.6, 1] },
    );

    feed.querySelectorAll<HTMLElement>('[data-episode-id]').forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [items]);

  return (
    <div className="relative h-dvh w-full bg-ink">
      {/* Desktop nav — /discover's own chrome (the filter trigger below) is
          deliberately minimal at every width, but that left zero way back to
          other tabs once BottomNav hides at lg (lg:hidden, added when
          HeaderNav was introduced — every other tab route renders AppHeader
          as that replacement, but this one never did). AppHeader's overlay
          variant already exists for exactly this over-video case (see
          HomeClient's hero) — reusing it rather than hand-rolling a second
          header bar. */}
      <div className="absolute inset-x-0 top-0 z-40 hidden lg:block">
        <AppHeader variant="overlay" />
      </div>

      {/* One small trigger, not a bar across the video — the whole
          complaint about the old chip row was that it stayed on screen
          permanently and competed with the content. Tapping it opens the
          genre list as a sheet; nothing sits over the video by default. */}
      <div className="absolute inset-x-0 top-0 z-30 pt-safe lg:top-16">
        <button
          onClick={() => setFilterOpen(true)}
          className="mt-3 ml-4 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 py-2 pr-3.5 pl-3 text-sm font-medium text-white backdrop-blur-xl transition-all duration-surface ease-enter active:scale-95"
        >
          <Icon name="filter" size={14} />
          {activeGenreLabel ?? 'ทั้งหมด'}
        </button>
      </div>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="หมวดหมู่">
        <div className="flex flex-wrap gap-2">
          {GENRES.map(({ label, slug }) => (
            <Chip
              key={label}
              active={activeSlug === slug}
              onClick={() => {
                setActiveSlug(slug);
                setFilterOpen(false);
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
      </Sheet>

      {items.length > 0 ? (
        <div ref={feedRef} className="scrollbar-hide h-full w-full snap-y snap-mandatory overflow-y-scroll">
          {items.map((item) => (
            <FeedSlide
              key={item.episodeId}
              item={item}
              isActive={activeEpisodeId === item.episodeId}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted((m) => !m)}
              router={router}
            />
          ))}
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <Icon name="inbox" size={32} className="text-fg-mute" />
          <p className="text-base font-medium text-fg">
            {activeSlug ? `ยังไม่มีเรื่องในหมวด${activeGenreLabel}` : 'ยังไม่มีเรื่องในตอนนี้'}
          </p>
          <button onClick={() => setActiveSlug(null)} className="text-sm font-medium text-brand-ink">
            ดูทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}

type DragLock = 'x' | 'y' | null;

function FeedSlide({
  item,
  isActive,
  isMuted,
  onToggleMute,
  router,
}: {
  item: FeedItem;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const { movie, episodeId } = item;
  const videoRef = useRef<HTMLVideoElement>(null);
  const { videoUrl, gate, error: loadError } = usePlaybackAuthorization(episodeId, router, isActive);
  const { isPlaying, setIsPlaying } = useHlsPlayer(videoRef, videoUrl, isActive);
  const { handleTimeUpdate, reportProgress } = useWatchProgress(episodeId, router, videoRef);
  const { liked, bookmarked, movieActionsLoading, pendingAction, toggleLike, toggleFavorite } =
    useMovieActions(movie.id, episodeId, router, isActive);

  // Drag-to-preview: the slide visually follows the finger on a rightward
  // swipe (touch-action: pan-y below leaves vertical scroll to the browser
  // and hands only horizontal movement to us), then either completes into
  // /movie/[id] or springs back — never a blind, undiscoverable gesture.
  const dragRef = useRef({ startX: 0, startY: 0, locked: null as DragLock, tracking: false });
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Play only the slide that's actually on screen; report progress via the
  // shared progress reporter when a slide scrolls away with playback to save.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (isActive) {
      void video.play().catch(() => {});
    } else {
      video.pause();
      const seconds = Math.floor(video.currentTime);
      void reportProgress(seconds);
    }
  }, [isActive, reportProgress, videoUrl]);

  const openDetails = () => {
    setLeaving(true);
    setDragX(window.innerWidth);
    window.setTimeout(() => router.push(`/movie/${movie.id}`), 180);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, locked: null, tracking: true };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.tracking) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      drag.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.locked === 'x') event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (drag.locked === 'x') {
      setDragging(true);
      setDragX(Math.max(0, dx));
    }
  };

  const endDrag = () => {
    if (dragRef.current.locked === 'x') {
      if (dragX > SWIPE_THRESHOLD) {
        openDetails();
      } else {
        setDragX(0);
      }
    }
    setDragging(false);
    dragRef.current = { startX: 0, startY: 0, locked: null, tracking: false };
  };

  const swipeProgress = Math.min(dragX / SWIPE_THRESHOLD, 1);

  return (
    <div
      data-episode-id={episodeId}
      className="relative h-dvh w-full snap-start overflow-hidden bg-ink [touch-action:pan-y]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        transform: `translateX(${dragX}px)`,
        opacity: 1 - swipeProgress * 0.35,
        transition: dragging ? 'none' : leaving ? 'transform 180ms ease-in' : 'transform 220ms cubic-bezier(0,0,0.2,1)',
      }}
    >
      {movie.posterUrl && (
        <Image
          src={movie.posterUrl}
          alt=""
          fill
          sizes="100vw"
          fetchPriority={isActive ? 'high' : 'auto'}
          className="object-cover lg:scale-110 lg:blur-2xl lg:brightness-[0.4]"
          aria-hidden="true"
        />
      )}

      {isActive && videoUrl && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover lg:object-contain"
          playsInline
          loop
          muted={isMuted}
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          onClick={onToggleMute}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />

      {gate && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-8 text-center">
          <Icon name="bookmarkFilled" size={28} className="text-gold" />
          <p className="text-sm text-fg-dim">เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น</p>
          <Button variant="primary" onClick={() => router.push(`/movie/${movie.id}`)}>
            ดูรายละเอียด
          </Button>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-8 text-center">
          <Icon name="alertCircle" size={26} className="text-fail" />
          <p className="text-sm text-fg-dim">{loadError}</p>
          <Button variant="secondary" onClick={() => router.push(`/movie/${movie.id}`)}>
            ดูรายละเอียด
          </Button>
        </div>
      )}

      {!gate && videoUrl && !isPlaying && isActive && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Icon name="play" size={30} className="ml-1 text-white/90" />
        </div>
      )}

      <button
        onClick={onToggleMute}
        aria-label={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
        className="absolute top-[calc(max(1rem,env(safe-area-inset-top))+0.75rem)] right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-xl transition-all duration-surface ease-enter active:scale-90"
      >
        <Icon name={isMuted ? 'volumeOff' : 'volumeOn'} size={18} />
      </button>

      {/* Right-edge swipe hint — grows more solid as the drag progresses,
          so the gesture is discoverable rather than blind. */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-10 items-center justify-center"
        style={{ opacity: 0.35 + swipeProgress * 0.65 }}
      >
        <Icon name="chevronRight" size={22} className="text-white" />
      </div>

      {/* Caption + rail */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 px-4 pb-24 lg:mx-auto lg:max-w-3xl lg:pb-8">
        <button onClick={openDetails} className="min-w-0 flex-1 text-left">
          <h2 className="truncate text-lg font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
            {movie.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-sm text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
            {movie.description}
          </p>
          <span className="mt-2 flex items-center gap-1 text-xs font-medium text-white/70">
            ปัดขวาเพื่อดูรายละเอียด
            <Icon name="chevronRight" size={14} />
          </span>
        </button>

        <div className="flex shrink-0 flex-col gap-4">
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
            label="บันทึก"
            activeLabel="นำออกจากรายการโปรด"
            disabled={movieActionsLoading || pendingAction !== null}
            showLabel
            onClick={(event) => {
              event.stopPropagation();
              void toggleFavorite();
            }}
          />
        </div>
      </div>
    </div>
  );
}
