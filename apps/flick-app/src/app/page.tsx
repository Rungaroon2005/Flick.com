'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

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
    <div className="flex min-h-dvh items-center justify-center overflow-hidden bg-ink">
      <div className="relative flex items-center justify-center">
        <div className="animate-logo-f absolute text-9xl font-black text-brand-ink [text-shadow:0_0_20px_var(--color-brand)]">
          F
        </div>
        <div className="animate-logo-full text-6xl font-black tracking-tight text-brand-ink opacity-0 [text-shadow:0_0_20px_var(--color-brand)]">
          Flick
        </div>
      </div>
    </div>
  );
}
