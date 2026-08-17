'use client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { MovieCard } from '@/features/catalog';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Movie } from '@/types';

const RECENT_SEARCHES_KEY = 'flick:recent-searches';
const RECENT_SEARCHES_EVENT = 'flick:recent-searches-changed';
const RECENT_SEARCHES_MAX = 5;
const EMPTY_RECENT_SEARCHES = '[]';
const GENRE_SHORTCUTS = ['ดราม่า', 'สยองขวัญ', 'แอ็คชั่น'];

function getRecentSearchesSnapshot(): string {
  try {
    return window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? EMPTY_RECENT_SEARCHES;
  } catch {
    return EMPTY_RECENT_SEARCHES;
  }
}

function getRecentSearchesServerSnapshot(): string {
  return EMPTY_RECENT_SEARCHES;
}

function subscribeToRecentSearches(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === RECENT_SEARCHES_KEY) onStoreChange();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(RECENT_SEARCHES_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(RECENT_SEARCHES_EVENT, onStoreChange);
  };
}

function parseRecentSearches(snapshot: string): string[] {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return Array.isArray(parsed)
      ? parsed.filter((term): term is string => typeof term === 'string').slice(0, RECENT_SEARCHES_MAX)
      : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(term: string, current: string[]): void {
  const next = [term, ...current.filter((t) => t !== term)].slice(0, RECENT_SEARCHES_MAX);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_SEARCHES_EVENT));
  } catch {
    // Non-authoritative UI convenience only — a full storage quota or a
    // privacy mode blocking localStorage should never break search itself.
  }
}

export default function SearchClient({ initialMovies }: { initialMovies: Movie[] }) {
  const [query, setQuery] = useState('');
  const recentSearchesSnapshot = useSyncExternalStore(
    subscribeToRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
  );
  const recentSearches = useMemo(() => parseRecentSearches(recentSearchesSnapshot), [recentSearchesSnapshot]);

  // No debounce here: this filters an already-loaded, in-memory catalogue
  // (there is no GET /movies?q= yet — see docs/FRONTEND_PLAN.md Appendix),
  // so there is no per-keystroke network call to throttle. Debouncing a
  // synchronous useMemo would only add typing lag for no benefit; revisit
  // once server-side search exists.
  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    const lowerQuery = query.toLowerCase();
    return initialMovies.filter(
      (movie) =>
        (movie.title && movie.title.toLowerCase().includes(lowerQuery)) ||
        (movie.genres && movie.genres.some((g) => g.name.toLowerCase().includes(lowerQuery))),
    );
  }, [query, initialMovies]);

  const commitSearch = (term: string) => {
    if (!term.trim()) return;
    saveRecentSearch(term, recentSearches);
  };

  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <AppHeader activeAction="search" />

      <main className="flex flex-col">
        <div className="sticky top-16 z-[99] bg-ink px-5 pt-2 pb-6">
          <div className="flex h-12 items-center gap-3 rounded-full border border-white/10 bg-ink-1/80 px-5 backdrop-blur-xl transition-colors duration-surface focus-within:border-brand-ink">
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
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-mute transition-all duration-surface ease-enter hover:text-fg active:scale-90"
                onClick={() => setQuery('')}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="animate-fade-in px-5">
          {!query.trim() ? (
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
