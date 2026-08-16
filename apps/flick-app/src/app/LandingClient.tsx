'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { Movie } from '@/types';

/**
 * The app's actual front door for a visitor with no session — replaces the
 * old auto-redirecting splash (user request, 2026-08-16: "landing page ...
 * modern and pro, real product"). An already-authenticated visitor still
 * skips straight to /home; this only ever renders for someone signed out,
 * so they can choose sign-up or sign-in themselves.
 *
 * Signature: a fanned stack of real poster cards rather than a full-bleed
 * poster wall — the app's actual differentiator is the swipeable vertical
 * feed built for /discover, so the hero foreshadows that mechanic instead
 * of doing the generic "streaming app poster grid" every competitor does.
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

  const [front, left, right] = movies;

  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <div className="flex flex-1 flex-col items-center justify-center overflow-hidden pt-safe">
        {/* Card fan — the one signature move on this page. Flexbox does the
            centering; negative margins create the overlap, so there's no
            manual percentage math to get wrong. */}
        <div className="flex h-64 items-end justify-center">
          {left?.posterUrl && (
            <div
              className="relative z-0 -mr-9 mb-3 aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl brightness-50"
              style={{ transform: 'rotate(-9deg)' }}
            >
              <Image src={left.posterUrl} alt="" fill sizes="128px" className="object-cover" />
            </div>
          )}
          {front?.posterUrl && (
            <div className="animate-card-peek relative z-10 aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)]">
              <Image src={front.posterUrl} alt={front.title} fill priority sizes="160px" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <span className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-coin backdrop-blur-sm">
                <Icon name="play" size={10} />
                ตอนที่ 1 ฟรี
              </span>
            </div>
          )}
          {right?.posterUrl && (
            <div
              className="relative z-0 -ml-9 mb-3 aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl brightness-50"
              style={{ transform: 'rotate(9deg)' }}
            >
              <Image src={right.posterUrl} alt="" fill sizes="128px" className="object-cover" />
            </div>
          )}
        </div>
        <Icon name="chevronDown" size={18} className="mt-1 -rotate-90 text-fg-mute" aria-hidden="true" />
      </div>

      {/* Content — quiet by comparison, on solid ink. */}
      <div className="flex flex-col gap-6 px-6 pb-safe">
        <div className="text-center">
          <div className="text-4xl leading-none font-extrabold tracking-tight text-brand-ink [text-shadow:0_2px_24px_rgba(204,51,0,0.4)]">
            Flick
          </div>
          <p className="mx-auto mt-4 max-w-xs text-xl leading-snug font-semibold text-fg">
            หนังสั้นพรีเมียม เขย่าอารมณ์ทุกตอน
          </p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-fg-dim">
            ปัดดูตอนใหม่ได้ทุกวัน ไม่ต้องเลือกนาน
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button variant="primary" size="lg" onClick={() => router.push('/register')} className="w-full">
            สมัครสมาชิกฟรี
          </Button>
          <Button variant="secondary" size="lg" onClick={() => router.push('/login')} className="w-full">
            เข้าสู่ระบบ
          </Button>
        </div>

        <p className="flex items-center justify-center gap-1.5 pb-1 text-xs text-fg-mute">
          <Icon name="checkCircle" size={14} className="text-ok" />
          ดูฟรีตอนที่ 1–10 ทุกเรื่อง ไม่ต้องผูกบัตร
        </p>
      </div>
    </div>
  );
}
