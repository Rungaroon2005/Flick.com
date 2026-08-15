import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton';

export default function HomeLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <main className="flex flex-col gap-6 pt-2">
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
