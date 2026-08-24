import { redirect } from 'next/navigation';
import BookmarksClient from './BookmarksClient';
import { AppHeader } from '@/components/ui/AppHeader';
import { Container } from '@/components/ui/Container';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { PageShell } from '@/components/ui/PageShell';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import { withNext } from '@/lib/nextParam';
import type { Movie } from '@/types';

// GET /me/bookmarks always 401s without a session, and there is nothing
// legitimate to show an anonymous visitor here. Authorisation therefore happens
// on the server, before any of this page is sent — same shape as /home — rather
// than behind a client-side flash of "no bookmarks".
export default async function BookmarksPage() {
  const session = await getSession();
  if (!session) redirect(withNext('/login', '/bookmarks'));

  let movies: Movie[];
  try {
    movies = await apiFetchServer('/me/bookmarks');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(withNext('/login', '/bookmarks'));
    console.error('Error fetching bookmarks on server:', error);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message="ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง" />
      </div>
    );
  }

  return (
    <PageShell>
      <AppHeader />

      <main>
        <Container>
          <h1 className="text-title mb-6 font-display">บันทึก</h1>
          <BookmarksClient movies={movies} />
        </Container>
      </main>
    </PageShell>
  );
}
