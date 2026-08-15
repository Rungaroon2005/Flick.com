'use client';

import { Sheet } from '@/components/ui/Sheet';
import type { Movie } from '@/types';

interface InfoModalProps {
  movie: Movie;
  onClose: () => void;
}

export default function InfoModal({ movie, onClose }: InfoModalProps) {
  return (
    <Sheet open onClose={onClose} title={movie.title}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-1.5 text-xs font-medium text-fg-dim">รายละเอียด</h3>
          <p className="text-sm text-fg">{movie.description}</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium text-fg-dim">ข้อมูลเนื้อหา</h3>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-ink-2 px-3 py-1 text-xs text-fg-dim">{movie.year}</span>
            <span className="rounded-full bg-ink-2 px-3 py-1 text-xs text-fg-dim">{movie.contentRating}</span>
            {movie.genres.map((genre) => (
              <span key={genre.id} className="rounded-full bg-ink-2 px-3 py-1 text-xs text-fg-dim">
                {genre.name}
              </span>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
