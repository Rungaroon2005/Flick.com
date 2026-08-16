'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ViewTransition } from 'react';
import InfoModal from './InfoModal';
import MovieCard from '@/components/MovieCard';
import { Icon } from '@/components/ui/Icon';
import { ReactionButton } from '@/components/ui/ReactionButton';
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
    <div className="min-h-dvh bg-ink pb-10">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-5 pt-safe pb-6">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        <button
          onClick={() => router.back()}
          aria-label="ปิด"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/40 text-fg backdrop-blur-xl transition-all duration-300 ease-out active:scale-90"
        >
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className="relative aspect-[2/3] max-h-[70vh] w-full overflow-hidden">
        {/* No poster morph here — see the comment in MovieCard.tsx for why. */}
        {movie.posterUrl && (
          <Image src={movie.posterUrl} alt={movie.title} fill priority sizes="100vw" className="object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-black/40" />
      </div>

      <div className="relative z-10 -mt-10 px-5">
        <h1 className="text-display font-display">{movie.title}</h1>
        <p className="mt-1 text-sm text-fg-dim">{movie.year} • {movie.contentRating}</p>

        <div className="mt-4 flex items-center gap-3">
          <button
            disabled={!firstEpisode}
            onClick={() => firstEpisode && router.push(`/player/${firstEpisode.id}`)}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white font-semibold text-ink shadow-lg shadow-black/25 transition-all duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <Icon name="play" size={18} />
            เล่น
          </button>
          <ReactionButton
            active={bookmarked}
            icon="bookmark"
            activeIcon="bookmarkFilled"
            label="บันทึก"
            activeLabel="นำออกจากรายการที่บันทึกไว้"
            size={48}
            onClick={toggleBookmark}
          />
          <button
            disabled={!firstEpisode}
            aria-label="ดาวน์โหลดตอนแรก"
            onClick={() => firstEpisode && addDownload(firstEpisode.id)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-fg/10 text-fg transition-all duration-300 ease-out hover:bg-fg/15 active:scale-90 disabled:opacity-40"
          >
            <Icon name="download" size={20} />
          </button>
        </div>
        {downloadMessage && (
          <p role="status" className="mt-3 text-sm text-fg-dim">{downloadMessage}</p>
        )}
      </div>

      <div className="mt-8 px-5">
        <h2 className="font-display text-lg font-bold text-fg">{movie.title} ซีซั่นที่ {selectedSeason}</h2>
        <p className="mt-2 text-base text-fg-dim">{movie.description}</p>
        <button
          onClick={() => setShowInfo(true)}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium text-fg-dim transition-opacity duration-300 active:opacity-70"
        >
          <Icon name="infoCircle" size={16} />
          ข้อมูลเพิ่มเติม
        </button>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between px-5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSeasonDropdownOpen(!seasonDropdownOpen)}
              aria-expanded={seasonDropdownOpen}
              aria-haspopup="listbox"
              aria-controls="season-options"
              className="flex items-center gap-1.5 font-display text-lg font-bold text-fg"
            >
              ซีซั่น {selectedSeason}
              <Icon name="chevronDown" size={18} className={`transition-transform duration-300 ${seasonDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {seasonDropdownOpen && (
              <div
                id="season-options"
                role="listbox"
                className="absolute top-full left-0 z-10 mt-2 min-w-32 overflow-hidden rounded-2xl border border-white/10 bg-ink-1/95 shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl"
              >
                {movie.seasons?.map((s) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.seasonNumber === selectedSeason}
                    key={s.id}
                    onClick={() => {
                      setSelectedSeason(s.seasonNumber);
                      setSeasonDropdownOpen(false);
                    }}
                    className={`block w-full px-4 py-2.5 text-left text-sm transition-colors duration-300 ${s.seasonNumber === selectedSeason ? 'bg-brand/15 text-brand-ink' : 'text-fg hover:bg-white/5'}`}
                  >
                    ซีซั่น {s.seasonNumber}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-sm text-fg-mute">{episodes.length} ตอน</span>
        </div>

        <div className="mt-4 flex flex-col gap-3 px-5">
          {episodes.map((ep) => (
            <div
              key={ep.id}
              className={`flex items-center gap-3 rounded-2xl border border-white/5 bg-ink-1 p-3 transition-all duration-300 ease-out [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:bg-ink-2 ${ep.coinCost > 0 ? 'opacity-80' : ''}`}
            >
              <button
                onClick={() => router.push(`/player/${ep.id}`)}
                aria-label={`เล่น ${ep.title}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-left transition-transform duration-300 active:scale-[0.98]"
              >
                <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-ink-2">
                  {(ep.thumbnailUrl || movie.posterUrl) && (
                    <ViewTransition name={`episode-${ep.id}`}>
                      <Image
                        src={(ep.thumbnailUrl || movie.posterUrl) ?? '/posters/sathu.jpg'}
                        alt=""
                        fill
                        sizes="112px"
                        className="object-cover"
                      />
                    </ViewTransition>
                  )}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-fg">{ep.title}</span>
                  {ep.coinCost > 0 && (
                    <span className="text-xs font-medium text-coin">ล็อก · {ep.coinCost} เหรียญ</span>
                  )}
                  <span className="text-xs text-fg-mute">{ep.durationMinutes} นาที</span>
                  <span className="line-clamp-1 text-xs text-fg-mute">{ep.description}</span>
                </span>
              </button>
              <button
                onClick={() => addDownload(ep.id)}
                aria-label={`ดาวน์โหลด ${ep.title}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-dim transition-all duration-300 ease-out hover:bg-white/5 active:scale-90"
              >
                <Icon name={downloadedEpisodeIds.has(ep.id) ? 'checkCircle' : 'download'} size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <h3 className="px-5 font-display text-lg font-bold text-fg">รายการที่คล้ายกัน</h3>
        <div className="scrollbar-hide mt-3 flex gap-3 overflow-x-auto px-5 pb-2">
          {similarMovies.slice(0, 5).map((m) => (
            <MovieCard key={m.id} movie={m} size="medium" />
          ))}
        </div>
      </div>

      {showInfo && <InfoModal movie={movie} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
