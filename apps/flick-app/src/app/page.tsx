'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import styles from './page.module.css';

export default function SplashPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoggedIn()) {
        router.push('/home');
      } else {
        router.push('/login');
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className={styles.container}>
      <div className={styles.logoContainer}>
        <div className={styles.logoF}>F</div>
        <div className={styles.logoFull}>Flick</div>
      </div>
    </div>
  );
}
