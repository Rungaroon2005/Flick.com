import Link from 'next/link';
import { redirect } from 'next/navigation';
import BookmarksClient from './BookmarksClient';
import { Icon } from '@/components/ui/Icon';
import { getSession } from '@/lib/session';

// GET /me/bookmarks always 401s without a session, and there is nothing
// legitimate to show an anonymous visitor here. Authorisation therefore happens
// on the server, before any of this page is sent — same shape as /home — rather
// than behind a client-side flash of "no bookmarks".
export default async function BookmarksPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-ink px-4 py-4">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        <div className="flex gap-4">
          <Link
            href="/downloads"
            aria-label="ดาวน์โหลด"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors hover:bg-fg/15"
          >
            <Icon name="download" size={18} />
          </Link>
          <Link
            href="/search"
            aria-label="ค้นหา"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg/10 text-fg transition-colors hover:bg-fg/15"
          >
            <Icon name="search" size={18} />
          </Link>
        </div>
      </header>

      <main className="px-4">
        <h1 className="text-title mb-6 font-display">บันทึก</h1>
        <BookmarksClient />
      </main>
    </div>
  );
}
