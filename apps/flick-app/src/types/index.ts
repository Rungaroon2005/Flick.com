/** Mirrors AuthenticatedUser in apps/flick-api/src/auth/current-user.decorator.ts
 *  — the body of GET /auth/me. */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  role: 'USER' | 'ADMIN';
  coinBalance: number;
}

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

/** Mirrors the Subscription model in apps/flick-api/prisma/schema.prisma —
 *  the body of GET /subscriptions/me (or no body at all when there is none). */
export interface Subscription {
  id: string;
  userId: string;
  planType: string; // 'weekly' | 'monthly' in practice
  status: 'ACTIVE' | 'CANCELED' | 'EXPIRED';
  autoRenew: boolean;
  startDate: string; // ISO string from backend
  endDate: string;
  paymentMethod: string;
  gatewaySubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One entry of SUBSCRIPTION_PLANS from GET /plans. The plan cards are rendered
 *  from this rather than from hardcoded JSX so the ids the client POSTs can
 *  never drift from the ids the API accepts. */
export interface SubscriptionPlan {
  id: string;
  name: string;
  nameEn: string;
  price: number;
  period: string;
  features: string[];
  featuresEn: string[];
  badge: string | null;
  color: string;
}

export interface CoinPack {
  id: string;
  name: string;
  coins: number;
  price: number;
  unlocks?: string;
  badge?: string;
}
