import type {
  AuthenticatedUser,
  BookmarkResponse,
  CheckoutResponse,
  CoinPack,
  ContinueWatchingItem,
  DownloadRecord,
  LikeResponse,
  Movie,
  MovieActionsResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  PlaybackAuthorization,
  Subscription,
  SubscriptionPlan,
  WalletResponse,
} from './index';

export interface PlansResponse {
  subscriptions: SubscriptionPlan[];
  coins: CoinPack[];
}

export type ApiPath =
  | '/auth/otp/request'
  | '/auth/otp/verify'
  | '/auth/logout'
  | '/auth/me'
  | '/movies'
  | `/movies?q=${string}`
  | '/me/bookmarks'
  | '/me/continue-watching'
  | '/me/downloads'
  | '/subscriptions/me'
  | '/wallet'
  | '/wallet/spend'
  | '/payments/checkout'
  | `/playback/${string}/authorize`
  | `/me/movies/${string}/actions`
  | `/me/likes/${string}`
  | `/me/bookmarks/${string}`
  | `/me/downloads/${string}`
  | `/me/watch-history/${string}`;

export type ApiResponse<Path extends ApiPath> =
  Path extends '/auth/otp/request' ? OtpRequestResponse
  : Path extends '/auth/otp/verify' ? OtpVerifyResponse
  : Path extends '/auth/logout' ? { success: boolean }
  : Path extends '/auth/me' ? AuthenticatedUser
  : Path extends '/movies' | '/me/bookmarks' ? Movie[]
  : Path extends `/movies?q=${string}` ? Movie[]
  : Path extends '/me/continue-watching' ? ContinueWatchingItem[]
  : Path extends '/me/downloads' ? DownloadRecord[]
  : Path extends '/subscriptions/me' ? Subscription | null | undefined
  : Path extends '/wallet' ? WalletResponse
  : Path extends '/payments/checkout' ? CheckoutResponse
  : Path extends `/playback/${string}/authorize` ? PlaybackAuthorization
  : Path extends `/me/movies/${string}/actions` ? MovieActionsResponse
  : Path extends `/me/likes/${string}` ? LikeResponse
  : Path extends `/me/bookmarks/${string}` ? BookmarkResponse
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

export function decodePlans(value: unknown): PlansResponse {
  const plans = requireRecord(value, 'plans');
  if (!Array.isArray(plans.subscriptions) || !Array.isArray(plans.coins)) {
    throw new TypeError('Invalid plans collections');
  }
  for (const planValue of plans.subscriptions) {
    const plan = requireRecord(planValue, 'subscription plan');
    if (typeof plan.id !== 'string' || typeof plan.price !== 'number' || !Array.isArray(plan.features)) {
      throw new TypeError('Invalid subscription plan');
    }
  }
  for (const packValue of plans.coins) {
    const pack = requireRecord(packValue, 'coin pack');
    if (typeof pack.id !== 'string' || typeof pack.coins !== 'number' || typeof pack.price !== 'number') {
      throw new TypeError('Invalid coin pack');
    }
  }
  return plans as unknown as PlansResponse;
}

export function decodeApiResponse<Path extends ApiPath>(path: Path, value: unknown): ApiResponse<Path> {
  if (path.startsWith('/movies?q=')) return decodeMovies(value) as ApiResponse<Path>;
  if (path === '/movies' || path === '/me/bookmarks') return decodeMovies(value) as ApiResponse<Path>;
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
    } else {
      requireNumber(authorization, 'coinCost');
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
  if (path === '/wallet') {
    const wallet = requireRecord(value, 'wallet');
    requireNumber(wallet, 'balance');
    return wallet as ApiResponse<Path>;
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
  if (path === '/auth/me' || path === '/auth/otp/verify') {
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
