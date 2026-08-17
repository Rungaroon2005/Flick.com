import { PageShell } from '@/components/ui/PageShell';
import { Skeleton } from '@/components/ui/Skeleton';

export default function SearchLoading() {
  return (
    <PageShell>
      <header className="flex items-center justify-between px-5 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
      </header>
      <div className="px-5 pt-2 pb-6">
        <Skeleton className="h-12 rounded-lg" />
      </div>
    </PageShell>
  );
}
