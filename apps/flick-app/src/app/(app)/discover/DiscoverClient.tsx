'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Movie } from '@/types';

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

export default function DiscoverClient({ initialMovies }: DiscoverClientProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const filteredMovies = useMemo(
    () =>
      activeSlug === null
        ? initialMovies
        : initialMovies.filter((movie) =>
            movie.genres.some((g) => g.slug === activeSlug),
          ),
    [activeSlug, initialMovies],
  );

  const activeGenreLabel = GENRES.find((g) => g.slug === activeSlug)?.label;

  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-[100] flex items-center justify-between bg-ink px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        <div className="flex gap-4">
          <Link
            href="/downloads"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors hover:bg-fg/15"
          >
            <Icon name="download" size={18} />
          </Link>
          <Link
            href="/search"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors hover:bg-fg/15"
          >
            <Icon name="search" size={18} />
          </Link>
        </div>
      </header>

      <main className="flex flex-col">
        <div className="sticky top-16 z-[99] bg-gradient-to-b from-ink from-80% to-transparent py-2 pb-5">
          <div className="flex gap-3 overflow-x-auto px-5 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            {GENRES.map(({ label, slug }) => (
              <Chip key={label} active={activeSlug === slug} onClick={() => setActiveSlug(slug)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="animate-fade-in px-5">
          {filteredMovies.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5">
              {filteredMovies.map((movie) => (
                <MovieCard key={movie.id} movie={movie} size="fill" />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="inbox"
              title={activeGenreLabel ? `ยังไม่มีเรื่องในหมวด${activeGenreLabel}` : 'ยังไม่มีเรื่องในตอนนี้'}
              action={{ label: 'ดูทั้งหมด', onClick: () => setActiveSlug(null) }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
