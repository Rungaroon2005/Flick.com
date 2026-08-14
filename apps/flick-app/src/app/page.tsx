'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

export default function SplashPage() {
  const router = useRouter();
  // Server-verified session (GET /auth/me), not a localStorage flag.
  const { user, loading } = useAuth();
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    if (loading) return;

    const minimumSplashMs = 300;
    const remainingMs = Math.max(0, minimumSplashMs - (Date.now() - startedAt));
    const timer = window.setTimeout(() => {
      router.push(user ? '/home' : '/login');
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, [router, user, loading, startedAt]);

  return (
    <div className={styles.container}>
      <div className={styles.logoContainer}>
        <div className={styles.logoF}>F</div>
        <div className={styles.logoFull}>Flick</div>
      </div>
    </div>
  );
}
