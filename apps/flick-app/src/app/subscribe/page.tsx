import { redirect } from 'next/navigation';
import SubscribeClient from './SubscribeClient';
import { getSession } from '@/lib/session';

// Keep plan selection inside the authenticated membership area, even while
// paid actions are disabled pending a payment-gateway integration.
//
// Safe for the registration flow: /register only pushes here after POST
// /auth/register has already set the session cookie, so the cookie exists by
// the time this Server Component runs.
export default async function SubscribePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <SubscribeClient />;
}
