'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { Icon } from '@/components/ui/Icon';
import { SkeletonPoster } from '@/components/ui/Skeleton';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { Movie } from '@/types';

const RECENT_SEARCHES_KEY = 'flick:recent-searches';
const RECENT_SEARCHES_MAX = 5;
const GENRE_SHORTCUTS = ['ดราม่า', 'สยองขวัญ', 'แอ็คชั่น'];

function loadRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(term: string, current: string[]): string[] {
  const next = [term, ...current.filter((t) => t !== term)].slice(0, RECENT_SEARCHES_MAX);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Non-authoritative UI convenience only — a full storage quota or a
    // privacy mode blocking localStorage should never break search itself.
  }
  return next;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lazy initializer, not an effect: this reads a synchronous external
  // source (localStorage) during the mount render itself, which is what
  // hydration re-runs on the client — an effect here would only cause an
  // avoidable extra render (see react-hooks/set-state-in-effect).
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Movie[]>('/movies')
      .then((data) => {
        if (!cancelled) setMovies(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof ApiError ? err.message : 'ไม่สามารถโหลดข้อมูลได้');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // No debounce here: this filters an already-loaded, in-memory catalogue
  // (there is no GET /movies?q= yet — see docs/FRONTEND_PLAN.md Appendix),
  // so there is no per-keystroke network call to throttle. Debouncing a
  // synchronous useMemo would only add typing lag for no benefit; revisit
  // once server-side search exists.
  const searchResults = useMemo(() => {
    if (!movies || !query.trim()) return null;
    const lowerQuery = query.toLowerCase();
    return movies.filter(
      (movie) =>
        (movie.title && movie.title.toLowerCase().includes(lowerQuery)) ||
        (movie.genres && movie.genres.some((g) => g.name.toLowerCase().includes(lowerQuery))),
    );
  }, [query, movies]);

  const commitSearch = (term: string) => {
    if (!term.trim()) return;
    setRecentSearches((prev) => saveRecentSearch(term, prev));
  };

  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-[100] flex items-center justify-between bg-ink px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        <div className="flex gap-4">
          <Link
            href="/downloads"
            aria-label="ดาวน์โหลด"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors hover:bg-fg/15"
          >
            <Icon name="download" size={18} />
          </Link>
          <span aria-label="ค้นหา" className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-ink/10 text-brand-ink">
            <Icon name="search" size={18} />
          </span>
        </div>
      </header>

      <main className="flex flex-col">
        <div className="sticky top-16 z-[99] bg-ink px-5 pt-2 pb-6">
          <div className="flex h-12 items-center gap-3 rounded-lg border border-hairline bg-ink-1 px-4 transition-colors focus-within:border-brand-ink">
            <Icon name="search" size={20} className="shrink-0 text-fg-mute" />
            <input
              type="text"
              placeholder="ค้นหาภาพยนตร์จีน, ภาพยนตร์ไทย..."
              className="flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-mute"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSearch(query);
              }}
            />
            {query && (
              <button
                aria-label="ล้างคำค้นหา"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-mute hover:text-fg"
                onClick={() => setQuery('')}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="animate-fade-in px-5">
          {error ? (
            <ErrorPanel message={error} onRetry={() => window.location.reload()} />
          ) : !query.trim() ? (
            <div className="flex flex-col gap-6">
              {recentSearches.length > 0 && (
                <section>
                  <h2 className="mb-3 text-xs font-medium text-fg-dim">ค้นหาล่าสุด</h2>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((term) => (
                      <Chip key={term} onClick={() => setQuery(term)}>
                        {term}
                      </Chip>
                    ))}
                  </div>
                </section>
              )}
              <section>
                <h2 className="mb-3 text-xs font-medium text-fg-dim">หมวดหมู่แนะนำ</h2>
                <div className="flex flex-wrap gap-2">
                  {GENRE_SHORTCUTS.map((label) => (
                    <Chip key={label} onClick={() => setQuery(label)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </section>
            </div>
          ) : movies === null ? (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonPoster key={i} />
              ))}
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4">
              {searchResults.map((movie) => (
                <MovieCard key={movie.id} movie={movie} size="fill" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <EmptyState icon="search" title={`ไม่พบ "${query}"`} description="ลองค้นด้วยชื่อเรื่องหรือหมวดหมู่" />
              <div className="flex flex-wrap justify-center gap-2">
                {GENRE_SHORTCUTS.map((label) => (
                  <Chip key={label} onClick={() => setQuery(label)}>
                    {label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
