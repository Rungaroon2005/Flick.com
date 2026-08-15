import { Skeleton } from '@/components/ui/Skeleton';

export default function DownloadsLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-4 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <main className="px-4">
        <Skeleton className="mb-2 h-7 w-40" />
        <Skeleton className="mb-6 h-4 w-64" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-md bg-ink-1 p-2">
              <Skeleton className="aspect-video w-30 shrink-0 rounded-sm" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
