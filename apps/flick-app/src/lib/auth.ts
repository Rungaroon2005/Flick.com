// Auth utilities for Flick - localStorage-based auth simulation
'use client';
import API_BASE_URL from '@/lib/api';

const AUTH_KEY = 'flick_auth';
const SUBSCRIPTION_KEY = 'flick_subscription';
const COINS_KEY = 'flick_coins';
const WATCH_HISTORY_KEY = 'flick_watch_history';
const BOOKMARKS_KEY = 'flick_bookmarks';
const DOWNLOADS_KEY = 'flick_downloads';

export function getUser(): any | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(AUTH_KEY);
  return data ? JSON.parse(data) : null;
}

export async function login(email: string, password: string): Promise<{ success: boolean; user?: any; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    
    if (!res.ok) {
      return { success: false, error: data.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
    }
    
    // Store only user metadata in localStorage, NOT the token. Token is now in HttpOnly cookie.
    const session = { ...data.user, loggedInAt: Date.now() };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { success: true, user: session };
  } catch (error) {
    return { success: false, error: 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้' };
  }
}

export async function register(data: { displayName: string; email: string; phone?: string; password: string }): Promise<{ success: boolean; user?: any; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        displayName: data.displayName,
        email: data.email,
        phone: data.phone || undefined,
        password: data.password
      }),
    });
    const result = await res.json();
    
    if (!res.ok) {
      const errMsg = Array.isArray(result.message) ? result.message[0] : (result.message || 'การสมัครสมาชิกผิดพลาด');
      return { success: false, error: errMsg };
    }
    
    const session = { ...result.user, loggedInAt: Date.now() };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { success: true, user: session };
  } catch (error) {
    return { success: false, error: 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้' };
  }
}

export async function logout(): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(AUTH_KEY);
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {
      console.error('Logout failed:', e);
    }
  }
}

export function isLoggedIn(): boolean {
  return !!getUser();
}

// Subscription
export function getSubscription(): any | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(SUBSCRIPTION_KEY);
  if (!data) return null;
  const sub = JSON.parse(data);
  if (sub.endDate && sub.endDate < Date.now()) {
    sub.status = 'expired';
    localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(sub));
  }
  return sub;
}

export function subscribe(planId: string): any {
  const now = Date.now();
  const durations: Record<string, number> = {
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
    trial: 7 * 24 * 60 * 60 * 1000,
  };
  const sub = {
    planId,
    status: 'active',
    startDate: now,
    endDate: now + (durations[planId] || durations.monthly),
    createdAt: now,
  };
  localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(sub));
  return sub;
}

export function hasActiveSubscription(): boolean {
  const sub = getSubscription();
  return sub && sub.status === 'active';
}

export function cancelSubscription(): void {
  const sub = getSubscription();
  if (sub) {
    sub.status = 'cancelled';
    localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(sub));
  }
}

// Coins
export function getCoins(): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(localStorage.getItem(COINS_KEY) || '0', 10);
}

export function addCoins(amount: number): number {
  const current = getCoins();
  localStorage.setItem(COINS_KEY, String(current + amount));
  return current + amount;
}

export function spendCoins(amount: number): boolean {
  const current = getCoins();
  if (current < amount) return false;
  localStorage.setItem(COINS_KEY, String(current - amount));
  return true;
}

// Watch History
export function getWatchHistory(): any[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(WATCH_HISTORY_KEY);
  return data ? JSON.parse(data) : [];
}

export function updateWatchProgress(movieId: string, episodeId: string, progress: number, duration: number): void {
  const history = getWatchHistory();
  const existing = history.findIndex((h: any) => h.episodeId === episodeId);
  const entry = {
    movieId, episodeId, progress, duration,
    completed: progress >= duration * 0.9,
    watchedAt: Date.now(),
  };
  if (existing >= 0) {
    history[existing] = entry;
  } else {
    history.unshift(entry);
  }
  localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
}

export function getContinueWatching(): any[] {
  return getWatchHistory().filter((h: any) => !h.completed).slice(0, 10);
}

// Bookmarks
export function getBookmarks(): string[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(BOOKMARKS_KEY);
  return data ? JSON.parse(data) : [];
}

export function toggleBookmark(movieId: string): boolean {
  const bookmarks = getBookmarks();
  const idx = bookmarks.indexOf(movieId);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
  } else {
    bookmarks.push(movieId);
  }
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  return bookmarks.includes(movieId);
}

export function isBookmarked(movieId: string): boolean {
  return getBookmarks().includes(movieId);
}

// Downloads
export function getDownloads(): any[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(DOWNLOADS_KEY);
  return data ? JSON.parse(data) : [];
}

export function addDownload(movieId: string, episodeId: string, movieTitle: string, episodeTitle: string, duration: number, thumbnail: string): void {
  const downloads = getDownloads();
  if (downloads.find((d: any) => d.episodeId === episodeId)) return;
  downloads.push({
    movieId, episodeId, movieTitle, episodeTitle,
    duration, thumbnail, downloadedAt: Date.now(),
  });
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads));
}

export function canPlayEpisode(episode: { coinCost: number }): boolean {
  if (episode.coinCost === 0) return true;
  if (hasActiveSubscription()) return true;
  return false;
}
