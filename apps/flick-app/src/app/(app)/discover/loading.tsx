import { Skeleton } from '@/components/ui/Skeleton';

/**
 * A wireframe of the real feed, not a generic gray box: same glass chip
 * row up top, one full-screen slide beneath it — matching the TikTok-style
 * layout DiscoverClient renders once data arrives.
 */
export default function DiscoverLoading() {
  return (
    <div className="relative h-dvh w-full bg-ink">
      <div className="absolute inset-x-0 top-0 z-30 border-b border-white/5 bg-black/25 pt-safe backdrop-blur-xl">
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20 shrink-0 rounded-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-full w-full rounded-none" />
    </div>
  );
}
