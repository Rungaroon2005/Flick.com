import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton';

export default function HomeLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <main className="flex flex-col gap-7 pt-2">
        <div className="flex gap-4 px-5 pb-6">
          <Skeleton className="aspect-[2/3] w-28 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="mt-1 flex gap-2">
              <Skeleton className="h-10 w-24 rounded-lg" />
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
          </div>
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <section key={i} className="flex flex-col gap-3">
            <div className="px-5">
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="px-5">
              <SkeletonRow count={4} />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
