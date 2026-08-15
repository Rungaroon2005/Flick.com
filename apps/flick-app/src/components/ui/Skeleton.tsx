interface SkeletonProps {
  className?: string;
}

/**
 * A quiet opacity pulse, not a sweeping shimmer — a shimmer across a grid
 * draws the eye to the loading itself (docs/FRONTEND_PLAN.md Part 3).
 * Compose this into a wireframe of the real layout per route; it is never
 * a substitute for matching the real grid/row count.
 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-ink-2 ${className}`} />;
}

export function SkeletonPoster({ className = '' }: SkeletonProps) {
  return <Skeleton className={`aspect-[2/3] w-full rounded-lg ${className}`} />;
}

export function SkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonPoster key={i} className="w-[42vw] max-w-40 shrink-0" />
      ))}
    </div>
  );
}
