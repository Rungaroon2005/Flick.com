import MovieClient from './MovieClient';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer } from '@/lib/session';
import { Movie } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function getMovie(id: string): Promise<Movie> {
  const res = await fetch(`${API_URL}/movies/${id}`, {
    next: { revalidate: 60 }
  });
  if (!res.ok) throw new Error('Failed to fetch movie');
  return res.json();
}

async function getSimilarMovies(id: string): Promise<Movie[]> {
  const res = await fetch(`${API_URL}/movies/${id}/similar`, {
    next: { revalidate: 60 }
  });
  if (!res.ok) throw new Error('Failed to fetch similar movies');
  return res.json();
}

// This page stays public — an anonymous visitor must still see the movie. So
// the bookmark check fails softly to false for them; only the *action* (the
// toggle in MovieClient) is gated on a session.
async function getIsBookmarked(movieId: string): Promise<boolean> {
  try {
    const bookmarks = await apiFetchServer<Movie[]>('/me/bookmarks');
    return bookmarks.some((m) => m.id === movieId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err; // a real API/network failure is an error, not "not bookmarked"
  }
}

// Next.js App Router exposes `params` to page components
export default async function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let movie: Movie | null = null;
  let similarMovies: Movie[] = [];
  let isBookmarked = false;
  let error: string | null = null;

  try {
    // Fetch both simultaneously for faster load times
    const [movieData, similarData] = await Promise.all([
      getMovie(id),
      getSimilarMovies(id)
    ]);
    movie = movieData;
    similarMovies = similarData;
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

  // Bookmark status is fetched separately from the movie itself. This route is
  // public and its content does not depend on the check, so an engagement-side
  // fault must degrade to "not bookmarked" rather than hide the movie. (401 is
  // already converted to false inside getIsBookmarked; only real faults land here.)
  try {
    isBookmarked = await getIsBookmarked(id);
  } catch (err) {
    console.error('Error fetching bookmark status:', err);
  }

  return <MovieClient movie={movie} similarMovies={similarMovies} initialBookmarked={isBookmarked} />;
}
