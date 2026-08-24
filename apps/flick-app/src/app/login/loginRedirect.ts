import { safeNext, withNext } from '@/lib/nextParam';

/**
 * Where a successful OTP verify lands. Split out of the page component so
 * the branching is testable without rendering a client component or
 * mocking the router.
 */
export function resolveLoginDestination(
  next: string | null | undefined,
  isNewUser: boolean,
): string {
  const safe = safeNext(next);
  if (isNewUser) return withNext('/subscribe', safe);
  return safe ?? '/home';
}
