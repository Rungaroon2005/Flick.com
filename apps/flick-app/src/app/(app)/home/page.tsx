import Link from 'next/link';
import { redirect } from 'next/navigation';
import HomeClient from './HomeClient';
import { Icon } from '@/components/ui/Icon';
import API_BASE_URL from '@/lib/api';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import { ContinueWatchingItem, Movie } from '@/types';

async function getMovies(): Promise<Movie[]> {
  // Public catalogue data only — safe to share across users, unlike the session.
  const res = await fetch(`${API_BASE_URL}/movies`, {
    next: { revalidate: 60 }, // ISR: Revalidate every 60 seconds
  });

  if (!res.ok) {
    throw new Error('Failed to fetch movies');
  }

  return res.json();
}

export default async function HomePage() {
  // Authorisation happens here, on the server, before any of this page is sent.
  // redirect() throws, so nothing below runs for an unauthenticated request.
  const session = await getSession();
  if (!session) redirect('/login');

  const [moviesResult, bookmarksResult, continueResult] = await Promise.allSettled([
    getMovies(),
    apiFetchServer<Movie[]>('/me/bookmarks'),
    apiFetchServer<ContinueWatchingItem[]>('/me/continue-watching'),
  ]);

  const privateFailures = [bookmarksResult, continueResult].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (privateFailures.some(({ reason }) => reason instanceof ApiError && reason.status === 401)) {
    redirect('/login');
  }

  const movies = moviesResult.status === 'fulfilled' ? moviesResult.value : [];
  const bookmarks = bookmarksResult.status === 'fulfilled' ? bookmarksResult.value : [];
  const continueWatching = continueResult.status === 'fulfilled' ? continueResult.value : [];
  const error = moviesResult.status === 'rejected' ? 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง' : null;

  if (moviesResult.status === 'rejected') console.error('Error fetching movies on server:', moviesResult.reason);
  if (bookmarksResult.status === 'rejected') console.error('Error fetching bookmarks on server:', bookmarksResult.reason);
  if (continueResult.status === 'rejected') console.error('Error fetching continue-watching on server:', continueResult.reason);

  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      {/* Top Bar (Server rendered) */}
      <header className="sticky top-0 z-[100] flex items-center justify-between bg-gradient-to-b from-black/90 to-transparent px-5 py-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
          <span className="truncate text-[13px] text-fg-mute">สวัสดี, {session.displayName}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/profile"
            className="flex items-center gap-1.5 rounded-full bg-fg/10 py-1.5 pr-3 pl-2 text-data font-medium text-coin"
          >
            <Icon name="coin" size={16} />
            {session.coinBalance}
          </Link>
          <Link
            href="/downloads"
            aria-label="ดาวน์โหลด"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors active:bg-fg/20"
          >
            <Icon name="download" size={18} />
          </Link>
          <Link
            href="/search"
            aria-label="ค้นหา"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors active:bg-fg/20"
          >
            <Icon name="search" size={18} />
          </Link>
        </div>
      </header>

      {error ? (
        <div className="flex h-[calc(100dvh-64px)] items-center justify-center text-fg">
          <p>{error}</p>
        </div>
      ) : (
        <HomeClient
          initialMovies={movies}
          initialBookmarks={bookmarks}
          initialContinueWatching={continueWatching}
        />
      )}
    </div>
  );
}
