import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton';

export default function HomeLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <main className="flex flex-col gap-10 pt-2 sm:gap-14">
        <div className="flex flex-col items-center gap-4 px-5 pb-2">
          <Skeleton className="aspect-[9/16] w-48 shrink-0 rounded-[28px] sm:w-60" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 sm:gap-14">
          {Array.from({ length: 3 }).map((_, i) => (
            <section key={i} className="flex flex-col gap-3">
              <div className="px-5">
                <Skeleton className="h-7 w-28" />
              </div>
              <div className="px-5">
                <SkeletonRow count={4} />
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
