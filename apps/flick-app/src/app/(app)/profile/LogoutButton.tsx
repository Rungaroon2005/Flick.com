'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/auth';

/**
 * The only interactive part of /profile, kept as a small client child so the
 * page itself stays a Server Component.
 *
 * The server owns session state; refreshing after navigation discards cached
 * authenticated Server Component output.
 */
export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    setPending(true);
    await logout();
    router.replace('/login');
    router.refresh(); // discard cached Server Component output for this user
  };

  return (
    <button className={className} onClick={handleLogout} disabled={pending}>
      {pending ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
    </button>
  );
}
