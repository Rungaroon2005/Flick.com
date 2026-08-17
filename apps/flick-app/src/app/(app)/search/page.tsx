import SearchClient from './SearchClient';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import API_BASE_URL from '@/lib/api';
import type { Movie } from '@/types';

async function getMovies(): Promise<Movie[]> {
  const response = await fetch(`${API_BASE_URL}/movies`, { next: { revalidate: 60 } });
  if (!response.ok) throw new Error('Failed to fetch movies');
  return response.json();
}

export default async function SearchPage() {
  let movies: Movie[] = [];
  let loadFailed = false;
  try {
    movies = await getMovies();
  } catch (error) {
    console.error('Error fetching search catalogue:', error);
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message="ไม่สามารถโหลดข้อมูลได้" />
      </div>
    );
  }

  return <SearchClient initialMovies={movies} />;
}
