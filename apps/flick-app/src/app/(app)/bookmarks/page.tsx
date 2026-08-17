import { redirect } from 'next/navigation';
import BookmarksClient from './BookmarksClient';
import { AppHeader } from '@/components/ui/AppHeader';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import type { Movie } from '@/types';

// GET /me/bookmarks always 401s without a session, and there is nothing
// legitimate to show an anonymous visitor here. Authorisation therefore happens
// on the server, before any of this page is sent — same shape as /home — rather
// than behind a client-side flash of "no bookmarks".
export default async function BookmarksPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let movies: Movie[];
  try {
    movies = await apiFetchServer('/me/bookmarks');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    console.error('Error fetching bookmarks on server:', error);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message="ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <AppHeader />

      <main className="px-4">
        <h1 className="text-title mb-6 font-display">บันทึก</h1>
        <BookmarksClient movies={movies} />
      </main>
    </div>
  );
}
