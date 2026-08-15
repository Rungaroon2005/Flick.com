import { Skeleton, SkeletonPoster } from '@/components/ui/Skeleton';

export default function BookmarksLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-4 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <main className="px-4">
        <Skeleton className="mb-6 h-7 w-24" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonPoster key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}
