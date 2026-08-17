import MovieClient from './MovieClient';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer } from '@/lib/session';
import { Movie } from '@/types';
import { decodeMovie, decodeMovies } from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function getMovie(id: string): Promise<Movie> {
  const res = await fetch(`${API_URL}/movies/${id}`, {
    next: { revalidate: 60 }
  });
  if (!res.ok) throw new Error('Failed to fetch movie');
  return decodeMovie(await res.json());
}

async function getSimilarMovies(id: string): Promise<Movie[]> {
  const res = await fetch(`${API_URL}/movies/${id}/similar`, {
    next: { revalidate: 60 }
  });
  if (!res.ok) throw new Error('Failed to fetch similar movies');
  return decodeMovies(await res.json());
}

// This page stays public — an anonymous visitor must still see the movie. So
// the bookmark check fails softly to false for them; only the *action* (the
// toggle in MovieClient) is gated on a session.
async function getIsBookmarked(movieId: string): Promise<boolean> {
  try {
    const bookmarks = await apiFetchServer('/me/bookmarks');
    return bookmarks.some((m) => m.id === movieId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    console.error('Error fetching bookmark status:', err);
    return false;
  }
}

// Next.js App Router exposes `params` to page components
export default async function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let movie: Movie | null = null;
  let similarMovies: Movie[] = [];
  let error: string | null = null;
  let isBookmarked = false;

  try {
    const [movieData, similarData, bookmarkData] = await Promise.all([
      getMovie(id),
      getSimilarMovies(id),
      getIsBookmarked(id),
    ]);
    movie = movieData;
    similarMovies = similarData;
    isBookmarked = bookmarkData;
  } catch (err) {
    console.error('Error fetching movie data:', err);
    error = 'ไม่สามารถโหลดข้อมูลภาพยนตร์ได้';
  }

  if (error || !movie) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message={error ?? 'กำลังโหลด…'} />
      </div>
    );
  }

  return <MovieClient movie={movie} similarMovies={similarMovies} initialBookmarked={isBookmarked} />;
}
