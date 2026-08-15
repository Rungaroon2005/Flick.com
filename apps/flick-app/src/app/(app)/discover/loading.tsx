import { Skeleton, SkeletonPoster } from '@/components/ui/Skeleton';

/**
 * A wireframe of the real layout, not a generic gray box — same chip row,
 * same 2-column grid, same tile count (docs/FRONTEND_PLAN.md Phase 3).
 */
export default function DiscoverLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <div className="flex gap-3 overflow-hidden px-5 pb-5">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 px-5 md:grid-cols-3 md:gap-5">
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonPoster key={i} className="w-full" />
        ))}
      </div>
    </div>
  );
}
