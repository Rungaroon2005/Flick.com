import LandingClient from './LandingClient';
import { redirect } from 'next/navigation';
import API_BASE_URL from '@/lib/api';
import { getSession } from '@/lib/session';
import { Movie } from '@/types';

// Public catalogue data only — safe to render for a visitor with no
// session at all, same ISR pattern as /discover and /home.
async function getMovies(): Promise<Movie[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/movies`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function LandingPage() {
  const [movies, session] = await Promise.all([getMovies(), getSession()]);
  if (session) redirect('/home');
  return <LandingClient movies={movies} />;
}
