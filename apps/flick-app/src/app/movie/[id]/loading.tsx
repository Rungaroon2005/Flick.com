import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton';

export default function MovieLoading() {
  return (
    <div className="min-h-dvh bg-ink pb-10">
      <Skeleton className="aspect-[2/3] max-h-[70vh] w-full rounded-none" />
      <div className="-mt-10 px-5">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <div className="mt-4 flex gap-3">
          <Skeleton className="h-12 flex-1 rounded-xl" />
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
      </div>
      <div className="mt-6 px-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-4/5" />
      </div>
      <div className="mt-6 flex flex-col gap-2 px-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="mt-8 px-5">
        <Skeleton className="mb-3 h-5 w-32" />
        <SkeletonRow count={4} />
      </div>
    </div>
  );
}
