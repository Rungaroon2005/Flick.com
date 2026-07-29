import DiscoverClient from './DiscoverClient';
import { Movie } from '@/types';
import API_BASE_URL from '@/lib/api';

// This is a React Server Component (no 'use client' directive).
// It runs entirely on the server, fetches data securely and quickly, 
// and passes the fully resolved JSON down to the client component.

export default async function DiscoverPage() {
  // Fetch data on the server during rendering
  // Next.js automatically caches this fetch call (unless dynamic headers/cookies are read)
  let movies: Movie[] = [];
  
  try {
    const res = await fetch(`${API_BASE_URL}/movies`, {
      // By default, Next.js caches this aggressively.
      // You can specify revalidation logic:
      next: { revalidate: 60 } // Revalidate every 60 seconds
    });
    
    if (res.ok) {
      movies = await res.json();
    }
  } catch (error) {
    console.error('Failed to fetch movies on server:', error);
  }

  // Pass the resolved data down to the interactive client component
  return <DiscoverClient initialMovies={movies} />;
}
