import { PageShell } from '@/components/ui/PageShell';
import { Skeleton, SkeletonPoster } from '@/components/ui/Skeleton';

export default function BookmarksLoading() {
  return (
    <PageShell>
      <header className="flex items-center justify-between px-4 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <main>
        <div className="mx-auto w-full max-w-page px-5 md:px-8 lg:px-10">
          <Skeleton className="mb-6 h-7 w-24" />
          <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonPoster key={i} />
            ))}
          </div>
        </div>
      </main>
    </PageShell>
  );
}
