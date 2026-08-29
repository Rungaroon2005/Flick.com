/** Mirrors AuthenticatedUser in apps/flick-api/src/auth/current-user.decorator.ts
 *  — the body of GET /auth/me. */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  role: 'USER' | 'ADMIN';
}

export interface AuthMutationResponse {
  success: boolean;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'displayName'>;
}

/** Body of POST /auth/otp/request. Identical whether or not an account exists. */
export interface OtpRequestResponse {
  ref: string;
  expiresIn: number;
}

/** Body of POST /auth/otp/verify. The token itself is in an HttpOnly cookie. */
export interface OtpVerifyResponse {
  success: boolean;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'displayName'> & {
    phone: string | null;
  };
  isNewUser: boolean;
}

export interface MovieActionsResponse {
  liked: boolean;
  bookmarked: boolean;
}

export interface LikeResponse {
  liked: boolean;
}

export interface BookmarkResponse {
  bookmarked: boolean;
}

/** Body of POST /payments/checkout. Deliberately carries no price — the
 *  server resolves the amount from its own catalog (see
 *  apps/flick-api/src/payments/catalog.ts). */
export interface CheckoutResponse {
  checkoutUrl: string;
  intentId: string;
}

export interface Episode {
  id: string;
  seasonId: string;
  episodeNumber: number;
  title: string;
  description: string | null;
  /** Present only in a successful playback authorization response. */
  videoUrl?: string | null;
  thumbnailUrl: string | null;
  durationMinutes: number;
  isPremium: boolean;
  releaseDate: string; // ISO string from backend
}

export type PlaybackAuthorization =
  | {
      allowed: true;
      reason: 'free' | 'subscription';
      videoUrl: string;
    }
  | {
      allowed: false;
      reason: 'subscription_required';
    };

export interface ContinueWatchingItem {
  id: string;
  progressSeconds: number;
  episode: Episode;
  movie: Movie;
}

export interface DownloadRecord {
  id: string;
  episodeId: string;
  expiresAt: string;
  downloadedAt: string;
  episode: Episode;
  movie: Movie;
}

/** Body of GET /episodes/:id — one episode plus the movie it belongs to.
 *  The movie deliberately carries no `seasons`: the player's only use for
 *  that was the catalogue walk this endpoint replaces. */
export interface EpisodeDetail {
  episode: Episode;
  movie: Movie;
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
  planType: string; // 'monthly' in practice
  status: 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'EXPIRED';
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

