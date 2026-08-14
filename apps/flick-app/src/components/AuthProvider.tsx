'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { apiFetch } from '@/lib/apiClient';
import type { AuthenticatedUser } from '@/types';

interface AuthContextValue {
  /** null means "not logged in as far as the server is concerned". */
  user: AuthenticatedUser | null;
  loading: boolean;
  /** Re-reads GET /auth/me. Call after login, register or logout. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const readSession = useCallback(async (): Promise<AuthenticatedUser | null> => {
    try {
      return await apiFetch<AuthenticatedUser>('/auth/me');
    } catch {
      // 401 (no/expired cookie) or the API being unreachable both mean
      // "we cannot prove who this is" — treat as logged out.
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await readSession();
    setUser(next);
    setLoading(false);
  }, [readSession]);

  useEffect(() => {
    let cancelled = false;
    void readSession().then((next) => {
      if (cancelled) return;
      setUser(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [readSession]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
