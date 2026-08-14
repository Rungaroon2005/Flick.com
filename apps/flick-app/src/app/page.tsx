'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import styles from './page.module.css';

export default function SplashPage() {
  const router = useRouter();
  // Server-verified session (GET /auth/me), not a localStorage flag.
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    const timer = setTimeout(() => {
      router.push(user ? '/home' : '/login');
    }, 3000);

    return () => clearTimeout(timer);
  }, [router, user, loading]);

  return (
    <div className={styles.container}>
      <div className={styles.logoContainer}>
        <div className={styles.logoF}>F</div>
        <div className={styles.logoFull}>Flick</div>
      </div>
    </div>
  );
}
