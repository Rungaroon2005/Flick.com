'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/components/AuthProvider';
import { Icon } from '@/components/ui/Icon';
import type { Movie } from '@/types';

/**
 * The app's front door for a signed-out visitor. Deliberately not a VOD
 * poster-wall: the differentiator is the vertical swipe feed at /discover,
 * so the hero leads with an actual 9:16 video card (not a 2:3 poster) in a
 * blurred coverflow, and the one real action is "enter the feed" rather
 * than a Play/More-info pair — there's nothing to "more info" about yet.
 * An already-authenticated visitor still skips straight to /home.
 */
export default function LandingClient({ movies }: { movies: Movie[] }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace('/home');
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink">
        <div className="animate-pulse text-4xl font-extrabold tracking-tight text-brand-ink">
          Flick
        </div>
      </div>
    );
  }

  const [hero, left, right] = movies;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-ink">
      {/* Immersive backdrop — the hero card's own poster, blown up and
          blurred. There is no separate landscape key art in this catalogue
          (every asset is portrait), so reusing the real artwork as ambient
          light reads as intentional, not a stretched fallback. */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        {hero?.posterUrl && (
          <Image
            src={hero.posterUrl}
            alt=""
            fill
            sizes="100vw"
            className="scale-125 object-cover object-top blur-3xl brightness-[0.32] saturate-150"
          />
        )}
        <div
          className="absolute h-80 w-80 rounded-full bg-brand-ink/35 blur-[110px]"
          style={{ top: '2%', left: '50%', transform: 'translateX(-50%)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/5 via-ink/70 to-ink" />
      </div>

      <header className="relative z-20 px-5 pt-safe pb-2">
        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-xl">
          <span className="text-sm font-extrabold tracking-tight text-brand-ink">Flick</span>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 py-4">
        {/* The one oversized typographic moment on the page — the hero card
            deliberately overlaps its lower half (negative margin, z-10 vs
            z-0), so word and image read as one composition. */}
        <div className="relative z-0 -mb-2 text-center">
          <h1 className="bg-gradient-to-b from-white to-brand-ink bg-clip-text font-display text-[4rem] leading-[0.82] font-extrabold tracking-tight text-transparent">
            หนังสั้น
          </h1>
          <p className="mt-1 font-display text-xl font-semibold text-fg [text-wrap:balance]">
            เขย่าอารมณ์ทุกตอน
          </p>
        </div>

        <div className="relative flex items-center justify-center" style={{ perspective: '900px' }}>
          {left?.posterUrl && (
            <div
              className="absolute z-0 aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-2xl brightness-[0.45]"
              style={{ transform: 'translateX(-112px) rotateY(24deg) scale(0.82)' }}
            >
              <Image src={left.posterUrl} alt="" fill sizes="96px" className="object-cover blur-[1px]" />
            </div>
          )}
          {right?.posterUrl && (
            <div
              className="absolute z-0 aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-2xl brightness-[0.45]"
              style={{ transform: 'translateX(112px) rotateY(-24deg) scale(0.82)' }}
            >
              <Image src={right.posterUrl} alt="" fill sizes="96px" className="object-cover blur-[1px]" />
            </div>
          )}
          {hero?.posterUrl && (
            <div className="animate-card-peek relative z-10 aspect-[9/16] w-48 shrink-0 overflow-hidden rounded-[28px] ring-1 ring-white/15 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)]">
              <Image src={hero.posterUrl} alt={hero.title} fill priority sizes="192px" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 backdrop-blur-xl">
                  <Icon name="play" size={16} className="text-white" />
                </div>
              </div>
              <span className="absolute top-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium tracking-wide text-coin backdrop-blur-sm">
                EP.1 ฟรี
              </span>
            </div>
          )}
        </div>

        <p className="max-w-[240px] text-center text-sm text-fg-dim">
          ปัดดูตอนใหม่ได้ทุกวัน ไม่ต้องเลือกนาน
        </p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-6 pb-safe">
        <div className="relative flex items-center justify-center">
          <span
            className="animate-cta-pulse absolute h-14 w-56 rounded-full border border-brand-ink/60"
            aria-hidden="true"
          />
          <span
            className="animate-cta-pulse absolute h-14 w-56 rounded-full border border-brand-ink/60"
            style={{ animationDelay: '1.1s' }}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => router.push('/register')}
            className="relative flex h-14 items-center gap-2 rounded-full border border-white/25 bg-brand/90 px-7 text-base font-semibold text-white shadow-[0_0_40px_-6px_rgba(255,77,26,0.7)] backdrop-blur-xl transition-transform active:scale-95"
          >
            เข้าสู่โลกหนังสั้น
            <Icon name="chevronDown" size={16} className="animate-bounce" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => router.push('/login')}
          className="text-sm text-fg-dim underline-offset-4 active:underline"
        >
          มีบัญชีแล้ว? เข้าสู่ระบบ
        </button>

        <div className="mb-1 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-fg-dim backdrop-blur-xl">
          <Icon name="checkCircle" size={13} className="text-ok" />
          ดูฟรีตอนที่ 1–10 ทุกเรื่อง ไม่ต้องผูกบัตร
        </div>
      </div>
    </div>
  );
}
