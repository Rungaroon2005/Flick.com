import type {
  AuthenticatedUser,
  BookmarkResponse,
  CheckoutResponse,
  ContinueWatchingItem,
  DownloadRecord,
  EpisodeDetail,
  FitsItem,
  LikeResponse,
  WatchStatusResponse,
  Movie,
  MovieActionsResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  PlaybackAuthorization,
  Subscription,
  SubscriptionPlan,
} from './index';

export interface PlansResponse {
  subscriptions: SubscriptionPlan[];
}

export type ApiPath =
  | '/auth/otp/request'
  | '/auth/otp/verify'
  | '/auth/logout'
  | '/auth/me'
  | '/auth/oauth/providers'
  | '/auth/oauth/nonce'
  | '/auth/oauth/verify'
  | '/movies'
  | `/movies?q=${string}`
  | `/episodes/${string}`
  | '/me/bookmarks'
  | '/me/continue-watching'
  | '/me/downloads'
  | '/subscriptions/me'
  | '/payments/checkout'
  | `/playback/${string}/authorize`
  | `/me/movies/${string}/actions`
  | `/me/likes/${string}`
  | `/me/bookmarks/${string}`
  | `/me/downloads/${string}`
  | `/me/watch-history/${string}`
  | `/discovery/fits?maxMinutes=${string}`
  | `/me/watch-status?movieIds=${string}`;

export type ApiResponse<Path extends ApiPath> =
  Path extends '/auth/otp/request' ? OtpRequestResponse
  : Path extends '/auth/otp/verify' ? OtpVerifyResponse
  : Path extends '/auth/logout' ? { success: boolean }
  : Path extends '/auth/me' ? AuthenticatedUser
  : Path extends '/auth/oauth/providers' ? { providers: string[] }
  : Path extends '/auth/oauth/nonce' ? { nonce: string; expiresIn: number }
  // Deliberately the same type as /auth/otp/verify: both endpoints return the
  // same { success, user, isNewUser } shape, and one type for one shape keeps
  // them from drifting apart.
  : Path extends '/auth/oauth/verify' ? OtpVerifyResponse
  : Path extends '/movies' | '/me/bookmarks' ? Movie[]
  : Path extends `/movies?q=${string}` ? Movie[]
  : Path extends `/episodes/${string}` ? EpisodeDetail
  : Path extends '/me/continue-watching' ? ContinueWatchingItem[]
  : Path extends '/me/downloads' ? DownloadRecord[]
  : Path extends '/subscriptions/me' ? Subscription | null | undefined
  : Path extends '/payments/checkout' ? CheckoutResponse
  : Path extends `/playback/${string}/authorize` ? PlaybackAuthorization
  : Path extends `/me/movies/${string}/actions` ? MovieActionsResponse
  : Path extends `/me/likes/${string}` ? LikeResponse
  : Path extends `/me/bookmarks/${string}` ? BookmarkResponse
  : Path extends `/discovery/fits?maxMinutes=${string}` ? FitsItem[]
  : Path extends `/me/watch-status?movieIds=${string}` ? WatchStatusResponse
  : unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Invalid ${label} response`);
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'boolean') throw new TypeError(`Invalid API field: ${key}`);
}

function requireNumber(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    throw new TypeError(`Invalid API field: ${key}`);
  }
}

const SCENE_MARKER_KINDS = new Set(['INTRO', 'RECAP', 'CREDITS']);

/** Validates each entry field-by-field rather than trusting the array
 *  shape: a malformed marker (e.g. a kind the frontend doesn't know
 *  about yet) must not crash the player, only fail to render a skip
 *  button for that one marker. */
function decodeSceneMarkers(value: unknown): void {
  if (!Array.isArray(value)) throw new TypeError('Invalid sceneMarkers');
  for (const entry of value) {
    const marker = requireRecord(entry, 'scene marker');
    if (typeof marker.kind !== 'string' || !SCENE_MARKER_KINDS.has(marker.kind)) {
      throw new TypeError('Invalid scene marker kind');
    }
    requireNumber(marker, 'startSeconds');
    requireNumber(marker, 'endSeconds');
  }
}

export function decodeMovie(value: unknown): Movie {
  const movie = requireRecord(value, 'movie');
  if (typeof movie.id !== 'string' || typeof movie.title !== 'string' || typeof movie.description !== 'string') {
    throw new TypeError('Invalid movie identity');
  }
  if (!Array.isArray(movie.genres)) throw new TypeError('Invalid movie genres');
  return movie as unknown as Movie;
}

export function decodeMovies(value: unknown): Movie[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid movies response');
  return value.map(decodeMovie);
}

export function decodeEpisodeDetail(value: unknown): EpisodeDetail {
  const detail = requireRecord(value, 'episode detail');
  const episode = requireRecord(detail.episode, 'episode');
  if (typeof episode.id !== 'string' || typeof episode.title !== 'string') {
    throw new TypeError('Invalid episode identity');
  }
  if (typeof episode.isPremium !== 'boolean') {
    throw new TypeError('Invalid episode isPremium');
  }
  decodeSceneMarkers(episode.sceneMarkers);
  return { episode, movie: decodeMovie(detail.movie) } as unknown as EpisodeDetail;
}

export function decodePlans(value: unknown): PlansResponse {
  const plans = requireRecord(value, 'plans');
  if (!Array.isArray(plans.subscriptions)) {
    throw new TypeError('Invalid plans collections');
  }
  for (const planValue of plans.subscriptions) {
    const plan = requireRecord(planValue, 'subscription plan');
    if (typeof plan.id !== 'string' || typeof plan.price !== 'number' || !Array.isArray(plan.features)) {
      throw new TypeError('Invalid subscription plan');
    }
  }
  return plans as unknown as PlansResponse;
}

const FITS_KINDS = new Set(['film', 'next_episode', 'first_episode']);

/** Reuses decodeMovie and decodeSceneMarkers rather than duplicating their
 *  field checks -- an item here is a (movie, episode) pair from the exact
 *  same catalogue shape /movies and /episodes/:id already validate. */
export function decodeFits(value: unknown): FitsItem[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid fits response');
  return value.map((entry) => {
    const item = requireRecord(entry, 'fits item');
    if (typeof item.kind !== 'string' || !FITS_KINDS.has(item.kind)) {
      throw new TypeError('Invalid fits item kind');
    }
    requireNumber(item, 'runtimeMinutes');
    if (typeof item.finishesAtHint !== 'string' || Number.isNaN(Date.parse(item.finishesAtHint))) {
      throw new TypeError('Invalid fits item finishesAtHint');
    }
    const episode = requireRecord(item.episode, 'fits episode');
    decodeSceneMarkers(episode.sceneMarkers);
    decodeMovie(item.movie);
    return item as unknown as FitsItem;
  });
}

const WATCH_STATUS_STATES = new Set(['none', 'partial', 'watched']);

export function decodeWatchStatus(value: unknown): WatchStatusResponse {
  const record = requireRecord(value, 'watch status');
  for (const [movieId, entry] of Object.entries(record)) {
    const status = requireRecord(entry, `watch status for ${movieId}`);
    if (typeof status.state !== 'string' || !WATCH_STATUS_STATES.has(status.state)) {
      throw new TypeError('Invalid watch status state');
    }
    requireNumber(status, 'percent');
    if (status.lastWatchedAt !== null) {
      if (
        typeof status.lastWatchedAt !== 'string' ||
        Number.isNaN(Date.parse(status.lastWatchedAt))
      ) {
        throw new TypeError('Invalid watch status lastWatchedAt');
      }
    }
  }
  return record as unknown as WatchStatusResponse;
}

export function decodeApiResponse<Path extends ApiPath>(path: Path, value: unknown): ApiResponse<Path> {
  if (path.startsWith('/discovery/fits')) return decodeFits(value) as ApiResponse<Path>;
  if (path.startsWith('/me/watch-status')) return decodeWatchStatus(value) as ApiResponse<Path>;
  if (path.startsWith('/movies?q=')) return decodeMovies(value) as ApiResponse<Path>;
  if (path === '/movies' || path === '/me/bookmarks') return decodeMovies(value) as ApiResponse<Path>;
  if (path.startsWith('/episodes/')) return decodeEpisodeDetail(value) as ApiResponse<Path>;
  if (path === '/me/continue-watching' || path === '/me/downloads') {
    if (!Array.isArray(value)) throw new TypeError(`Invalid ${path} response`);
    return value as ApiResponse<Path>;
  }
  if (path === '/subscriptions/me' && (value === null || value === undefined)) {
    return value as ApiResponse<Path>;
  }
  if (path === '/subscriptions/me') {
    const subscription = requireRecord(value, 'subscription');
    if (typeof subscription.id !== 'string' || typeof subscription.status !== 'string') {
      throw new TypeError('Invalid subscription');
    }
    return subscription as ApiResponse<Path>;
  }

  if (path.startsWith('/playback/') && path.endsWith('/authorize')) {
    const authorization = requireRecord(value, 'playback authorization');
    requireBoolean(authorization, 'allowed');
    if (authorization.allowed) {
      if (typeof authorization.videoUrl !== 'string') throw new TypeError('Invalid playback videoUrl');
    }
    return authorization as ApiResponse<Path>;
  }

  if (path.startsWith('/me/movies/')) {
    const actions = requireRecord(value, 'movie actions');
    requireBoolean(actions, 'liked');
    requireBoolean(actions, 'bookmarked');
    return actions as ApiResponse<Path>;
  }
  if (path.startsWith('/me/likes/')) {
    const result = requireRecord(value, 'like');
    requireBoolean(result, 'liked');
    return result as ApiResponse<Path>;
  }
  if (path.startsWith('/me/bookmarks/')) {
    const result = requireRecord(value, 'bookmark');
    requireBoolean(result, 'bookmarked');
    return result as ApiResponse<Path>;
  }
  if (path === '/payments/checkout') {
    const checkout = requireRecord(value, 'checkout');
    if (
      typeof checkout.checkoutUrl !== 'string' ||
      typeof checkout.intentId !== 'string'
    ) {
      throw new TypeError('Invalid checkout response');
    }
    return checkout as ApiResponse<Path>;
  }
  if (path === '/auth/otp/request') {
    const otp = requireRecord(value, 'otp request');
    if (typeof otp.ref !== 'string') throw new TypeError('Invalid otp ref');
    requireNumber(otp, 'expiresIn');
    return otp as ApiResponse<Path>;
  }
  if (path === '/auth/oauth/providers') {
    const listed = requireRecord(value, 'oauth providers');
    if (
      !Array.isArray(listed.providers) ||
      listed.providers.some((id) => typeof id !== 'string')
    ) {
      throw new TypeError('Invalid oauth providers');
    }
    return listed as ApiResponse<Path>;
  }
  if (path === '/auth/oauth/nonce') {
    const issued = requireRecord(value, 'oauth nonce');
    if (typeof issued.nonce !== 'string') throw new TypeError('Invalid oauth nonce');
    requireNumber(issued, 'expiresIn');
    return issued as ApiResponse<Path>;
  }
  if (
    path === '/auth/me' ||
    path === '/auth/otp/verify' ||
    path === '/auth/oauth/verify'
  ) {
    const envelope = requireRecord(value, 'authentication');
    const user =
      path === '/auth/me' ? envelope : requireRecord(envelope.user, 'authentication user');
    if (typeof user.id !== 'string' || typeof user.displayName !== 'string') {
      throw new TypeError('Invalid authentication user');
    }
    return envelope as ApiResponse<Path>;
  }
  if (path === '/auth/logout') {
    const result = requireRecord(value, 'logout');
    requireBoolean(result, 'success');
    return result as ApiResponse<Path>;
  }

  return value as ApiResponse<Path>;
}
