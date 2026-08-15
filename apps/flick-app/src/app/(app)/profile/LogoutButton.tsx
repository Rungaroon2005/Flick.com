'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';

/**
 * The only interactive part of /profile, kept as a small client child so the
 * page itself stays a Server Component.
 *
 * `refresh()` is not optional: logout() clears the HttpOnly cookie on the
 * server, but AuthProvider's in-memory `user` would otherwise stay populated
 * for the rest of the session. The splash screen at src/app/page.tsx reads
 * useAuth().user to decide between /home and /login, so a stale value there
 * sends a just-logged-out user on a pointless bounce through /home (whose own
 * server guard then kicks them back to /login).
 */
export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    setPending(true);
    await logout();
    await refresh(); // drop the now-invalid client-side session
    router.push('/login');
    router.refresh(); // discard cached Server Component output for this user
  };

  return (
    <button className={className} onClick={handleLogout} disabled={pending}>
      {pending ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
    </button>
  );
}
