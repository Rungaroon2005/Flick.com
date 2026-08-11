import MovieClient from './MovieClient';
import styles from './page.module.css';
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
  const res = await fetch(`${API_URL}/movies`, {
    next: { revalidate: 60 }
  });
  if (!res.ok) throw new Error('Failed to fetch similar movies');
  const allMovies: Movie[] = await res.json();
  return allMovies.filter(m => m.id !== id);
}

// Next.js App Router exposes `params` to page components
export default async function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let movie: Movie | null = null;
  let similarMovies: Movie[] = [];
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
      <div className={styles.container}>
        <div className={styles.loading}>
          <p>{error || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <MovieClient movie={movie} similarMovies={similarMovies} />
    </div>
  );
}
