'use client';

import Image from 'next/image';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import type { DownloadRecord } from '@/types';

export default function DownloadsClient({
  initialDownloads,
}: {
  initialDownloads: DownloadRecord[];
}) {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-ink px-4 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        <div className="flex gap-4">
          <span aria-label="ดาวน์โหลด" className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-brand-ink">
            <Icon name="download" size={18} />
          </span>
          <Link
            href="/search"
            aria-label="ค้นหา"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors hover:bg-fg/15"
          >
            <Icon name="search" size={18} />
          </Link>
        </div>
      </header>

      <main className="px-4">
        <h1 className="text-title mb-1 font-display">รายการดาวน์โหลด</h1>
        <p className="mb-6 text-sm text-fg-dim">
          หน้านี้บันทึกรายการไว้ในบัญชี ยังไม่รองรับการรับชมแบบออฟไลน์
        </p>

        {initialDownloads.length === 0 ? (
          <EmptyState
            icon="download"
            title="ยังไม่มีตอนที่ดาวน์โหลด"
            description="ดาวน์โหลดไว้ดูตอนไม่มีเน็ตได้"
            action={{ label: 'ไปเลือกเรื่อง', href: '/discover' }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {initialDownloads.map((item) => (
              <Link
                href={`/player/${item.episode.id}`}
                className="flex items-center gap-4 rounded-md bg-ink-1 p-2"
                key={item.id}
              >
                <div className="relative aspect-video w-30 shrink-0 overflow-hidden rounded-sm">
                  {(item.episode.thumbnailUrl || item.movie.posterUrl) && (
                    <Image
                      src={(item.episode.thumbnailUrl || item.movie.posterUrl) ?? '/posters/sathu.jpg'}
                      alt=""
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-[0.95rem] text-fg">{item.movie.title}</h2>
                  <span className="text-xs text-fg-dim">
                    ตอนที่ {item.episode.episodeNumber} · {item.episode.durationMinutes} นาที
                  </span>
                  {item.episode.description && (
                    <p className="m-0 mt-0.5 line-clamp-1 text-xs text-fg-mute">
                      {item.episode.description}
                    </p>
                  )}
                </div>
                <Icon name="play" size={18} className="shrink-0 px-2 text-ok" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
