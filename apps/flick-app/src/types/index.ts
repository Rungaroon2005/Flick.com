export interface Episode {
  id: string;
  seasonId: string;
  episodeNumber: number;
  title: string;
  description: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMinutes: number;
  coinCost: number;
  releaseDate: string; // ISO string from backend
}

export interface Season {
  id: string;
  movieId: string;
  seasonNumber: number;
  title: string;
  episodeCount: number;
  episodes: Episode[];
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
}

export interface Movie {
  id: string;
  title: string;
  description: string;
  posterUrl: string | null;
  trailerUrl: string | null;
  year: number;
  contentRating: string;
  genres: Genre[];
  seasons?: Season[];
}

export interface CoinPack {
  id: string;
  name: string;
  coins: number;
  price: number;
  unlocks?: string;
  badge?: string;
}
