import { redirect } from 'next/navigation';
import SubscribeClient from './SubscribeClient';
import { getSession } from '@/lib/session';

// POST /subscriptions 401s without a session, so the page is guarded on the
// server — same shape as /home and /bookmarks — rather than letting an
// anonymous visitor click through to a guaranteed failure.
//
// Safe for the registration flow: /register only pushes here after POST
// /auth/register has already set the session cookie, so the cookie exists by
// the time this Server Component runs.
export default async function SubscribePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <SubscribeClient />;
}
