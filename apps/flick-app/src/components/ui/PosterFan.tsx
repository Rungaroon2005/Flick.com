import Image from 'next/image';
import { Icon } from './Icon';
import type { Movie } from '@/types';

interface PosterFanProps {
  /** All three are optional: LandingClient destructures `movies` positionally
   *  (`const [hero, left, right] = movies`), so a short catalogue yields
   *  undefined rather than an error, and the fan degrades to what it has. */
  hero?: Movie;
  left?: Movie;
  right?: Movie;
  /** Rendered over the hero card's top-left — the "EP.1 ฟรี" chip. */
  badge?: string;
}

/**
 * Three posters fanned around a 9:16 hero — the app's identity set-piece.
 * It reads as Flick specifically because the geometry only works for a
 * portrait catalogue: a 16:9 competitor cannot copy it without reshooting.
 *
 * The perspective lives here, not on the caller. rotateY with no ancestor
 * perspective is a flat horizontal squash rather than depth, and this was
 * previously the only perspective in the codebase — easy to omit and hard
 * to notice omitting.
 *
 * The flanking cards are 2:3 (the catalogue's poster ratio) while the hero
 * is 9:16 (the player's ratio). That mismatch is deliberate: it stages the
 * transition from browsing to watching.
 */
export function PosterFan({ hero, left, right, badge }: PosterFanProps) {
  return (
    <div
      className="relative flex items-center justify-center [perspective:var(--perspective-depth)]"
    >
      {left?.posterUrl && (
        <div
          aria-hidden="true"
          className="absolute z-0 aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-2xl brightness-[0.45]"
          style={{ transform: 'translateX(-170px) rotateY(24deg) scale(0.82)' }}
        >
          <Image src={left.posterUrl} alt="" fill sizes="96px" className="object-cover blur-[1px]" />
        </div>
      )}
      {right?.posterUrl && (
        <div
          aria-hidden="true"
          className="absolute z-0 aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-2xl brightness-[0.45]"
          style={{ transform: 'translateX(170px) rotateY(-24deg) scale(0.82)' }}
        >
          <Image src={right.posterUrl} alt="" fill sizes="96px" className="object-cover blur-[1px]" />
        </div>
      )}
      {hero?.posterUrl && (
        <div className="animate-card-peek relative z-10 aspect-[9/16] w-48 shrink-0 overflow-hidden rounded-[28px] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] ring-1 ring-white/15 md:w-56 lg:w-64">
          <Image
            src={hero.posterUrl}
            alt={hero.title}
            fill
            priority
            sizes="(min-width: 1024px) 256px, (min-width: 768px) 224px, 192px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 backdrop-blur-xl">
              <Icon name="play" size={16} className="text-white" />
            </div>
          </div>
          {badge && (
            <span className="absolute top-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium tracking-wide text-gold backdrop-blur-sm">
              {badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
