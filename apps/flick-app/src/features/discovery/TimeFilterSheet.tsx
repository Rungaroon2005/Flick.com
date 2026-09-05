'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Sheet } from '@/components/ui/Sheet';
import { formatClockTime } from '@/features/playback';
import { FITS_MINUTES_OPTIONS, fetchFits, type FitsMinutes } from './api';
import type { FitsItem } from '@/types';

const KIND_LABELS: Record<FitsItem['kind'], string> = {
  film: 'ดูจบในตอนเดียว',
  next_episode: 'ดูต่อ',
  first_episode: 'เริ่มดู',
};

export function TimeFilterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState<FitsMinutes | null>(null);
  const [items, setItems] = useState<FitsItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (value: FitsMinutes) => {
    setMinutes(value);
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchFits(value));
    } catch {
      setError('โหลดรายการไม่สำเร็จ กรุณาลองใหม่');
      setItems(null);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setMinutes(null);
    setItems(null);
    setError(null);
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="มีเวลาเท่าไหร่?"
    >
      <div className="flex flex-wrap gap-2">
        {FITS_MINUTES_OPTIONS.map((option) => (
          <button
            type="button"
            key={option}
            aria-pressed={minutes === option}
            onClick={() => void choose(option)}
            className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-surface ease-enter active:scale-95 ${
              minutes === option
                ? 'bg-brand text-ink shadow-[0_0_16px_-3px_rgba(246,131,85,0.6)]'
                : 'bg-ink-2 text-fg-dim hover:bg-hairline'
            }`}
          >
            {option} นาที
          </button>
        ))}
      </div>

      {/* Mood row -- stubbed for Phase C (NewPlan Mood Match). Not
          interactive yet, matching the "เร็ว ๆ นี้" placeholder pattern
          already used on the profile page's settings rows. */}
      <div className="mt-6 border-t border-hairline pt-6">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-fg-dim">อารมณ์ไหน</h4>
          <span className="rounded-full bg-ink-2 px-2.5 py-1 text-xs text-fg-mute">เร็ว ๆ นี้</span>
        </div>
      </div>

      <div className="mt-6 border-t border-hairline pt-6">
        {loading && <p className="text-center text-sm text-fg-dim">กำลังค้นหา...</p>}
        {error && <p className="text-center text-sm text-fail">{error}</p>}
        {!loading && !error && items && items.length === 0 && (
          <p className="text-center text-sm text-fg-dim">ไม่พบเรื่องที่พอดีกับเวลานี้</p>
        )}
        {!loading && items && items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={`${item.movie.id}-${item.episode.id}`}>
                <button
                  type="button"
                  onClick={() => router.push(`/player/${item.episode.id}`)}
                  className="focus-ring flex w-full items-center gap-3 rounded-xl border border-white/5 bg-ink-1 p-2.5 text-left transition-all duration-surface ease-enter hover:bg-ink-2 active:scale-[0.98]"
                >
                  <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-ink-2">
                    {item.movie.posterUrl && (
                      <Image src={item.movie.posterUrl} alt="" fill sizes="48px" className="object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{item.movie.title}</span>
                    <span className="block truncate text-xs text-fg-mute">
                      {KIND_LABELS[item.kind]} · {item.runtimeMinutes} นาที · จบ{' '}
                      {formatClockTime(new Date(item.finishesAtHint))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
