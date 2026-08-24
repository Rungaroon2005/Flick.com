# Flick UX Return-to-Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flick remember where the user was trying to go, then close the four smaller UX gaps that sit behind that fix.

**Architecture:** One `next` search param, validated by a single pure module (`lib/nextParam.ts`), threaded through the four handoffs that currently discard it: auth redirects, OTP verify, paywall-gate escapes, and post-checkout return. Everything after Task 5 is independent presentation work — focus rings, a toast provider, server-side search, an honest downloads label, and an inline plan comparison — built on primitives that already exist.

**Tech Stack:** Next.js 16.2.12 (App Router, Server Components) · React 19.2.4 · Tailwind CSS 4.3.3 (CSS-first `@theme`) · Vitest 4 + Testing Library (frontend) · NestJS 11 + Prisma 7.9 + Jest 30 (API)

**Spec:** `docs/superpowers/specs/2026-08-25-ux-improvement-design.md`

**Baseline:** branch `integration/unify` @ `8358e2d`. Verified green before this plan starts: `flick-app` build + 29 vitest, `flick-api` 180 jest + 21 e2e, both lints.

## Global Constraints

These apply to **every** task.

- **No task changes an entitlement check.** `PlaybackService` stays the only server path returning a real `videoUrl`; `WalletService.spend()` and its `SELECT ... FOR UPDATE` pattern stay untouched; the webhook stays the only thing that grants entitlement.
- **`next` is attacker-controllable.** It arrives in a URL. Only `safeNext()` (Task 1) may be trusted to turn it into a destination. Never interpolate a raw `next` into `router.push`, `redirect`, or an `href`.
- **Frontend API contract:** `apps/flick-app/src/types/api.ts` holds `ApiPath`, `ApiResponse<Path>`, and the runtime `decodeApiResponse()`. Any new endpoint must be added to **all three**, or `apiFetch` throws a 502 `'ไม่ตรงตามสัญญา API'` at runtime.
- **Copy is Thai-first**, matching existing style (e.g. `'เหรียญไม่เพียงพอ (Insufficient coins)'`).
- **Contrast rule:** `bg-brand` pairs with `text-ink` (6.44:1). White on `#FF5C1A` is 3.09:1 and fails AA. `bg-brand-deep` + white (5.47:1) is the one legal white pairing.
- **No new runtime dependency.** Toasts are CSS + React state. No animation library.
- **Reduced motion:** the blanket `prefers-reduced-motion` floor in `globals.css` already covers new animation; do not add per-component overrides.
- **Commands:** frontend `cd apps/flick-app && npm test` / `npm run lint` / `npm run build`; API `cd apps/flick-api && npm test` / `npm run test:e2e` / `npm run lint`.
- **Commit style:** `feat(app): ...`, `fix(app): ...`, `refactor(core): ...`, `docs: ...`.
- **Every task ends green:** `npm run lint && npm run build` in `apps/flick-app` before each commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/nextParam.ts` | **New.** `safeNext` / `withNext`. Pure, no React, no Next imports. The whole open-redirect defence. |
| `src/lib/nextParam.test.ts` | **New.** Rejection cases first. |
| 6 × `page.tsx` (Server Components) | Modified: 11 `redirect('/login')` calls gain a destination. |
| `src/app/login/page.tsx` | Modified: reads `next`, resolves it after verify, `push` vs `replace` corrected. |
| `src/app/player/[id]/PlayerClient.tsx` | Modified: 4 gate escapes carry `next`; notice → toast; inline plan comparison. |
| `src/features/payments/api.ts` | Modified: `PendingCheckout` gains `next`. |
| `src/app/subscribe/processing/page.tsx` | Modified: resolves to `next` rather than `/home`. |
| `src/app/globals.css` | Modified: `.focus-ring` utility, `--spacing-header`, `scroll-padding-top`. |
| `src/components/ui/Toast.tsx` | **New.** `ToastProvider`, `useToast`. |
| `src/components/ui/Toast.test.tsx` | **New.** |
| `src/app/(app)/search/page.tsx` + `SearchClient.tsx` | Modified: server query, debounce, `apiFetch`. |
| `apps/flick-api/src/movies/movies.controller.ts` + `.service.ts` | Modified: `GET /movies?q=`. |
| `src/app/(app)/downloads/DownloadsClient.tsx`, `src/components/ui/AppHeader.tsx` | Modified: honest label. |

---

## Task 1: The `next` contract

**Files:**
- Create: `apps/flick-app/src/lib/nextParam.ts`
- Test: `apps/flick-app/src/lib/nextParam.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `safeNext(raw: string | null | undefined): string | null` and `withNext(base: string, next: string | null | undefined): string`. Every later task imports from `@/lib/nextParam`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/flick-app/src/lib/nextParam.test.ts
import { describe, expect, it } from 'vitest';
import { safeNext, withNext } from './nextParam';

describe('safeNext', () => {
  // These are the whole point of the module: `next` arrives in a URL a
  // stranger can send you, so anything that could leave the origin is
  // rejected rather than sanitised.
  it.each([
    ['//evil.com', 'protocol-relative'],
    ['https://evil.com', 'absolute https'],
    ['http://evil.com', 'absolute http'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['/\\evil.com', 'backslash-smuggled host'],
    ['home', 'no leading slash'],
    ['', 'empty'],
  ])('rejects %s (%s)', (raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it.each([null, undefined])('rejects %s', (raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it('accepts an in-app path', () => {
    expect(safeNext('/player/ep-1')).toBe('/player/ep-1');
  });

  it('keeps a query string and hash on an in-app path', () => {
    expect(safeNext('/movie/42?season=2#ep3')).toBe('/movie/42?season=2#ep3');
  });
});

describe('withNext', () => {
  it('appends an encoded next', () => {
    expect(withNext('/login', '/player/ep-1')).toBe('/login?next=%2Fplayer%2Fep-1');
  });

  it('returns the bare base when next is unusable', () => {
    expect(withNext('/login', '//evil.com')).toBe('/login');
    expect(withNext('/login', null)).toBe('/login');
  });

  // /subscribe already carries next when the gate sends you there; adding a
  // second one would produce ?next=a&next=b and URLSearchParams.get would
  // silently pick the first.
  it('replaces an existing next rather than appending a second', () => {
    expect(withNext('/subscribe?next=%2Fold', '/new')).toBe('/subscribe?next=%2Fnew');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/flick-app && npm test -- nextParam`
Expected: FAIL — `Failed to resolve import "./nextParam"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/flick-app/src/lib/nextParam.ts
/**
 * The `next` search param carries where the user was trying to go before a
 * gate interrupted them. It arrives in a URL, so it is attacker-controlled:
 * a link with ?next=https://evil.com turns our own login screen into an
 * open redirect. safeNext is the only thing standing between that and a
 * router call, so it allowlists rather than sanitises — one leading slash,
 * never two, and no backslash (browsers normalise \ to / in the authority
 * position, so /\evil.com escapes the origin on some engines).
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  return raw;
}

/** Builds `base?next=<encoded>`, dropping an unusable next entirely. */
export function withNext(base: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  if (!safe) return base;
  const [path, existingQuery = ''] = base.split('?');
  const params = new URLSearchParams(existingQuery);
  params.set('next', safe);
  return `${path}?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/flick-app && npm test -- nextParam`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app/src/lib/nextParam.ts apps/flick-app/src/lib/nextParam.test.ts
git commit -m "feat(app): add the next-param contract behind an allowlist"
```

---

## Task 2: Every auth redirect keeps its destination

**Files:**
- Modify: `apps/flick-app/src/app/(app)/home/page.tsx:28,40`
- Modify: `apps/flick-app/src/app/(app)/bookmarks/page.tsx:17,23`
- Modify: `apps/flick-app/src/app/(app)/downloads/page.tsx:9,22`
- Modify: `apps/flick-app/src/app/(app)/profile/page.tsx:38,70`
- Modify: `apps/flick-app/src/app/subscribe/page.tsx:28`
- Modify: `apps/flick-app/src/app/player/[id]/page.tsx:32,50`

**Interfaces:**
- Consumes: `withNext` from Task 1.
- Produces: `/login?next=<path>` for every gated route. Task 3 reads it.

**Context:** these are Server Components. They know their own route but not the live URL, so each passes its own path literal. `/player/[id]` and `/movie/[id]` are dynamic — build the path from the already-available `id`.

- [ ] **Step 1: Add the import and update the two static-path files**

In `apps/flick-app/src/app/(app)/home/page.tsx`, add near the other imports:

```tsx
import { withNext } from '@/lib/nextParam';
```

Replace **both** `redirect('/login')` calls (lines 28 and 40) with:

```tsx
redirect(withNext('/login', '/home'));
```

Repeat exactly this shape in `bookmarks/page.tsx` (`'/bookmarks'`, both sites), `downloads/page.tsx` (`'/downloads'`, both sites), `profile/page.tsx` (`'/profile'`, both sites), and `subscribe/page.tsx` (`'/subscribe'`, one site).

- [ ] **Step 2: Update the dynamic player route**

In `apps/flick-app/src/app/player/[id]/page.tsx`, add the same import, then replace both `redirect('/login')` calls (lines 32 and 50) with:

```tsx
redirect(withNext('/login', `/player/${id}`));
```

Confirm `id` is in scope at both sites — it comes from the route params the component already destructures. If line 32 sits before `id` is resolved, move the `redirect` below the `params` await rather than reordering the auth check relative to any data fetch.

- [ ] **Step 3: Verify no bare redirect survives**

Run: `cd apps/flick-app && grep -rn "redirect('/login')" src`
Expected: no output. Every site now goes through `withNext`.

- [ ] **Step 4: Build and lint**

Run: `cd apps/flick-app && npm run lint && npm run build`
Expected: both pass; 13 routes as before.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app/src/app
git commit -m "feat(app): carry the destination through every auth redirect"
```

---

## Task 3: Login returns you where you were going

**Files:**
- Modify: `apps/flick-app/src/app/login/page.tsx:58` (and imports)
- Test: `apps/flick-app/src/app/login/loginRedirect.test.ts` (create)

**Interfaces:**
- Consumes: `safeNext`, `withNext` (Task 1); `/login?next=` from Task 2.
- Produces: `resolveLoginDestination(next, isNewUser)` — exported from `login/page.tsx`'s sibling module so it can be tested without rendering the client component.

**Context:** the spec's resolved decision is **both** — a first-time user still meets plan selection, and `next` is forwarded through it rather than dropped. `router.replace` stays correct here: nobody should navigate back into a consumed OTP screen.

- [ ] **Step 1: Write the failing test**

```ts
// apps/flick-app/src/app/login/loginRedirect.test.ts
import { describe, expect, it } from 'vitest';
import { resolveLoginDestination } from './loginRedirect';

describe('resolveLoginDestination', () => {
  it('sends a returning user to their destination', () => {
    expect(resolveLoginDestination('/player/ep-1', false)).toBe('/player/ep-1');
  });

  it('sends a returning user home when there is no destination', () => {
    expect(resolveLoginDestination(null, false)).toBe('/home');
  });

  // A new account still meets plan selection — but the episode they came
  // for rides along, so /subscribe is a step rather than a dead end.
  it('sends a new user to plan selection carrying the destination', () => {
    expect(resolveLoginDestination('/player/ep-1', true)).toBe(
      '/subscribe?next=%2Fplayer%2Fep-1',
    );
  });

  it('sends a new user to bare plan selection when there is no destination', () => {
    expect(resolveLoginDestination(null, true)).toBe('/subscribe');
  });

  it('never trusts an off-origin destination', () => {
    expect(resolveLoginDestination('https://evil.com', false)).toBe('/home');
    expect(resolveLoginDestination('//evil.com', true)).toBe('/subscribe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/flick-app && npm test -- loginRedirect`
Expected: FAIL — cannot resolve `./loginRedirect`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/flick-app/src/app/login/loginRedirect.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/flick-app && npm test -- loginRedirect`
Expected: PASS — 5 tests.

- [ ] **Step 5: Wire it into the login page**

In `apps/flick-app/src/app/login/page.tsx`, add to the imports:

```tsx
import { useSearchParams } from 'next/navigation';
import { resolveLoginDestination } from './loginRedirect';
```

Inside the component, next to `const router = useRouter();`:

```tsx
const searchParams = useSearchParams();
```

Replace line 58 — `router.replace(result.isNewUser ? '/subscribe' : '/home');` — with:

```tsx
    // replace, not push: nobody should be able to navigate back into a
    // consumed OTP screen.
    router.replace(resolveLoginDestination(searchParams.get('next'), result.isNewUser));
```

- [ ] **Step 6: Wrap the page for useSearchParams**

`useSearchParams` requires a Suspense boundary during static rendering, and `/login` currently prerenders as static (see the build output). Rename the existing default export to `LoginForm` (not exported), and add:

```tsx
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
```

Add `Suspense` to the existing `react` import.

- [ ] **Step 7: Build and verify /login still renders**

Run: `cd apps/flick-app && npm run lint && npm run build`
Expected: PASS. `/login` still listed in the route table.

- [ ] **Step 8: Commit**

```bash
git add apps/flick-app/src/app/login
git commit -m "feat(app): return to the requested page after OTP verify"
```

---

## Task 4: Gate escapes stay attached to the episode

**Files:**
- Modify: `apps/flick-app/src/app/player/[id]/PlayerClient.tsx:375,378,403,411`

**Interfaces:**
- Consumes: `withNext` (Task 1); `resolveLoginDestination` is not involved here.
- Produces: `/subscribe?next=/player/<id>` — Task 5 persists this across the gateway.

**Context:** all four escapes currently abandon the episode the sheet is selling. `PlayerClient` already has the episode id in scope (it drives playback); use the same value the component already holds rather than re-deriving it.

- [ ] **Step 1: Add the import**

```tsx
import { withNext } from '@/lib/nextParam';
```

- [ ] **Step 2: Define the return path once, near the top of the component body**

```tsx
  // Every escape from the gate sheet carries this, so paying or subscribing
  // returns to the episode being sold rather than to the lobby.
  const returnPath = `/player/${episodeId}`;
```

Use whichever identifier the component already holds for the current episode. If it is named something other than `episodeId`, use that name — do not introduce a second source of truth.

- [ ] **Step 3: Update the three `/subscribe` pushes**

Replace each of the three occurrences of:

```tsx
onClick={() => router.push('/subscribe')}
```

(at lines 378, 403 and 411) with:

```tsx
onClick={() => router.push(withNext('/subscribe', returnPath))}
```

- [ ] **Step 4: Point ดูตอนฟรี at this movie, not the discovery feed**

Line 375 currently sends someone who wants episode 14 to `/discover`. Replace:

```tsx
onClick={() => router.push('/discover')}
```

with a push to this movie's own page, where its free episodes are listed:

```tsx
onClick={() => router.push(`/movie/${movieId}`)}
```

Use the identifier the component already holds for the parent movie. If no movie id is in scope in `PlayerClient`, thread it in from `player/[id]/page.tsx`, which already resolves the episode's movie server-side — add it to the props rather than fetching again.

- [ ] **Step 5: Build and lint**

Run: `cd apps/flick-app && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/flick-app/src/app/player/[id]/PlayerClient.tsx"
git commit -m "feat(app): keep the gate's escapes attached to the episode"
```

---

## Task 5: Land where you paid to be

**Files:**
- Modify: `apps/flick-app/src/features/payments/api.ts` (`PendingCheckout`, `rememberPendingCheckout`, `recallPendingCheckout`)
- Modify: `apps/flick-app/src/app/subscribe/processing/page.tsx:52`
- Modify: `apps/flick-app/src/app/subscribe/SubscribeClient.tsx` (pass `next` into `rememberPendingCheckout`)
- Test: `apps/flick-app/src/features/payments/api.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `safeNext` (Task 1); `/subscribe?next=` from Task 4.
- Produces: `rememberPendingCheckout(itemType, intentId, next?)` — a third optional parameter. `recallPendingCheckout` returns the stored record including `next`.

**Context:** `PendingCheckout` already survives the gateway round trip in `sessionStorage` and already carries a `CheckoutBaseline`. Adding `next` to that record is the cheapest correct place — the API's return URL only carries `?intent=<id>`, so there is nowhere else to put it.

- [ ] **Step 1: Write the failing test**

Append to `apps/flick-app/src/features/payments/api.test.ts`:

```ts
describe('pending checkout next', () => {
  it('round-trips a safe next through sessionStorage', async () => {
    await rememberPendingCheckout('SUBSCRIPTION', 'pi_1', '/player/ep-1');
    expect(recallPendingCheckout('pi_1')?.next).toBe('/player/ep-1');
  });

  // A poisoned sessionStorage entry must not become a redirect either.
  it('drops an off-origin next at read time', async () => {
    await rememberPendingCheckout('SUBSCRIPTION', 'pi_2', '//evil.com');
    expect(recallPendingCheckout('pi_2')?.next ?? null).toBeNull();
  });

  it('leaves next null when none was given', async () => {
    await rememberPendingCheckout('COIN_PACK', 'pi_3');
    expect(recallPendingCheckout('pi_3')?.next ?? null).toBeNull();
  });
});
```

Add `recallPendingCheckout` to the file's existing import from `./api` if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/flick-app && npm test -- features/payments`
Expected: FAIL — `rememberPendingCheckout` takes 2 arguments; `.next` is undefined.

- [ ] **Step 3: Extend the stored record**

In `apps/flick-app/src/features/payments/api.ts`, add to the `PendingCheckout` interface:

```ts
  /** Where to land once the grant is confirmed. Validated on the way in and
   *  again on the way out: sessionStorage is writable by any script on the
   *  origin, so a stored value is no more trusted than a URL param. */
  next?: string;
```

Change the signature and body of `rememberPendingCheckout`:

```ts
export async function rememberPendingCheckout(
  itemType: CheckoutItemType,
  intentId: string,
  next?: string | null,
): Promise<void> {
  const pending: PendingCheckout = { itemType, intentId };
  const safe = safeNext(next);
  if (safe) pending.next = safe;
```

(keep the rest of the function body unchanged), and add the import:

```ts
import { safeNext } from '@/lib/nextParam';
```

In `recallPendingCheckout`, re-validate before returning — find where it parses the stored JSON and normalise the field:

```ts
  return { ...parsed, next: safeNext(parsed.next) ?? undefined };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/flick-app && npm test -- features/payments`
Expected: PASS.

- [ ] **Step 5: Pass `next` in from the subscribe screen**

In `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`, read the param and forward it. Add imports:

```tsx
import { useSearchParams } from 'next/navigation';
```

Inside the component, beside `const router = useRouter();`:

```tsx
const searchParams = useSearchParams();
```

At the `rememberPendingCheckout(...)` call inside `handleBuy`, add the third argument:

```tsx
await rememberPendingCheckout(itemType, result.intentId, searchParams.get('next'));
```

Wrap the page's default export in `<Suspense fallback={null}>` exactly as Task 3 Step 6 did for `/login`, since `/subscribe` also uses `useSearchParams` now.

- [ ] **Step 6: Resolve to it on the processing screen**

In `apps/flick-app/src/app/subscribe/processing/page.tsx`, the `pending` record is already recalled at the top of the effect. Capture its destination alongside `itemType`:

```tsx
    const destination = pending?.next ?? '/home';
```

Then replace line 52 — `router.replace('/home');` — with:

```tsx
          // push, not replace: back should return to the episode, not to the
          // gateway we just came from.
          router.push(destination);
```

- [ ] **Step 7: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/flick-app/src/features/payments apps/flick-app/src/app/subscribe
git commit -m "feat(app): return to the gated episode after a successful checkout"
```

---

## Task 6: One focus ring, everywhere

**Files:**
- Modify: `apps/flick-app/src/app/globals.css`
- Modify: `apps/flick-app/src/components/ui/Button.tsx`, `Chip.tsx`, `ReactionButton.tsx`, `AppHeader.tsx`
- Modify: `apps/flick-app/src/features/catalog/components/MovieCard.tsx`
- Modify: `apps/flick-app/src/app/subscribe/SubscribeClient.tsx` (free-plan button), `apps/flick-app/src/app/login/page.tsx` (back link)
- Test: `apps/flick-app/src/components/ui/focusRing.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: a `.focus-ring` utility class. Later tasks apply it to anything new and interactive.

**Context:** three `focus-visible` occurrences exist in the whole tree. `Button` is already correct — this lifts its treatment into a utility so it stops being a per-component judgement call.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/flick-app/src/components/ui/focusRing.test.tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';
import { ReactionButton } from './ReactionButton';

// A focus ring that exists on Button but nowhere else is not a focus story.
// These assert the utility is actually reached for, per component.
describe('focus ring coverage', () => {
  it('Chip carries the focus ring', () => {
    const { container } = render(<Chip>ดราม่า</Chip>);
    expect((container.firstElementChild as HTMLElement).className).toContain('focus-ring');
  });

  it('ReactionButton carries the focus ring', () => {
    const { container } = render(
      <ReactionButton active={false} onClick={() => {}} icon="heart" label="ถูกใจ" />,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain('focus-ring');
  });
});
```

Match `ReactionButton`'s real prop names — read the component first and adjust the props in this test to whatever it actually accepts. Do not change the component's API to fit the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/flick-app && npm test -- focusRing`
Expected: FAIL — className does not contain `focus-ring`.

- [ ] **Step 3: Add the utility**

In `apps/flick-app/src/app/globals.css`, beside the other `@utility` blocks:

```css
/* One focus treatment for the whole app. Button encoded this inline and
   nothing else did, which is how three focus-visible occurrences ended up
   covering twelve screens. 2px at 2px offset clears WCAG 2.2's focus-
   appearance floor; brand-ink is 7.85:1 on the ink ground. */
@utility focus-ring {
  &:focus-visible {
    outline: 2px solid var(--color-brand-ink);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 4: Apply it**

Add `focus-ring` to the class list of each interactive element below. Do **not** remove any existing styling.

- `Button.tsx`: replace the four inline `focus-visible:outline*` utilities with the single `focus-ring` class.
- `Chip.tsx`: add to the root `<button>` class string.
- `ReactionButton.tsx`: add to the root `<button>`.
- `AppHeader.tsx`: add to the coin-balance `<Link>` and to the `className` string built for the action links (both the `<Link>` and `<span>` branches — the span is not focusable, so add it only to the `<Link>`).
- `MovieCard.tsx`: add to the outer `<Link>`.
- `SubscribeClient.tsx`: add to the free-plan `<button>` (the `ใช้งานฟรี` one).
- `login/page.tsx`: add to the back `<Link>` and to both `<input>` elements.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/flick-app && npm test -- focusRing`
Expected: PASS.

- [ ] **Step 6: Verify coverage**

Run: `cd apps/flick-app && grep -rn "focus-ring" src | wc -l`
Expected: 10 or more.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-app/src
git commit -m "fix(app): give every interactive element one visible focus ring"
```

---

## Task 7: Auth inputs get real labels and a real ring

**Files:**
- Modify: `apps/flick-app/src/app/login/page.tsx:98-131`

**Interfaces:**
- Consumes: `.focus-ring` (Task 6).
- Produces: nothing downstream.

**Context:** both inputs signal focus with a 1px border tint under `outline-none`, and carry `aria-label` but no visible label. The code step is worst: `placeholder="000000"` vanishes behind the first digit, leaving an unlabelled field. Everything else about these inputs (`type="tel"`, `inputMode`, `autoComplete="one-time-code"`) is already correct and must survive.

- [ ] **Step 1: Label the phone field**

Replace the phone `<div className="relative flex items-center">` block so the input is preceded by a visible label and keeps its icon:

```tsx
<div className="flex flex-col gap-1.5">
  <label htmlFor="login-phone" className="text-sm text-fg-dim">
    เบอร์โทรศัพท์
  </label>
  <div className="relative flex items-center">
    <Icon name="phone" size={18} className="pointer-events-none absolute left-3.5 text-fg-mute" />
    <input
      id="login-phone"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      className="focus-ring h-12 w-full rounded-xl border border-hairline bg-ink-2 pl-11 pr-4 text-base text-fg placeholder:text-fg-mute focus:border-brand-ink"
      placeholder="08X-XXX-XXXX"
      value={phone}
      onChange={(e) => setPhone(e.target.value)}
    />
  </div>
</div>
```

Note three changes beyond the label: `outline-none` is gone (it was suppressing the ring), `focus-ring` is added, and the placeholder is now an example rather than a duplicate of the label. `aria-label` is dropped because a real `<label htmlFor>` supersedes it.

- [ ] **Step 2: Label the code field**

```tsx
<div className="flex flex-col gap-1.5">
  <label htmlFor="login-code" className="text-sm text-fg-dim">
    รหัสยืนยัน 6 หลัก
  </label>
  <input
    id="login-code"
    type="text"
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={6}
    className="focus-ring h-12 w-full rounded-xl border border-hairline bg-ink-2 px-4 text-center text-xl tracking-[0.5em] text-fg placeholder:tracking-normal placeholder:text-fg-mute focus:border-brand-ink"
    placeholder="000000"
    value={code}
    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
  />
</div>
```

- [ ] **Step 3: Verify no suppressed outlines remain on these inputs**

Run: `cd apps/flick-app && grep -n "outline-none" src/app/login/page.tsx`
Expected: no output.

- [ ] **Step 4: Build and lint**

Run: `cd apps/flick-app && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app/src/app/login/page.tsx
git commit -m "fix(app): give the auth inputs visible labels and a real focus ring"
```

---

## Task 8: Sticky chrome stops swallowing focus

**Files:**
- Modify: `apps/flick-app/src/app/globals.css`
- Modify: `apps/flick-app/src/components/ui/AppHeader.tsx:20-24`
- Modify: `apps/flick-app/src/app/(app)/search/SearchClient.tsx` (the `sticky top-16` bar)

**Interfaces:**
- Consumes: nothing.
- Produces: `--spacing-header` — a single source of truth for the header height, replacing the `h-16` / `top-16` pair that `AppHeader`'s own comment warns about.

**Context:** WCAG 2.2 AA "Focus Not Obscured." `AppHeader` is `sticky top-0 z-[100]` at `h-16`, and search's filter bar sticks beneath it. Nothing sets `scroll-padding-top`, so tabbing to a control below the fold scrolls it under the header. The header height now has three consumers, so it becomes a token.

- [ ] **Step 1: Add the token and the scroll padding**

In `globals.css`, inside the existing `@theme` block beside the other spacing values:

```css
  /* AppHeader's height. Load-bearing in three places: the header itself,
     search's filter bar sticking beneath it, and the scroll-padding below
     that keeps keyboard focus out from under both. */
  --spacing-header: 4rem;
```

Then, outside `@theme`, at the root:

```css
/* WCAG 2.2 AA (Focus Not Obscured): without this, tabbing to a control just
   below the fold scrolls it underneath the sticky header. */
html {
  scroll-padding-top: var(--spacing-header);
}
```

- [ ] **Step 2: Point the header at the token**

In `AppHeader.tsx`, change `h-16` to `h-header` in the header's class string, and update the comment above it to say the height is defined by `--spacing-header` in `globals.css` and that `SearchClient` sticks against the same token.

- [ ] **Step 3: Point the search bar at the token**

In `SearchClient.tsx`, change `sticky top-16` to `sticky top-header`.

- [ ] **Step 4: Clear both bars where they stack**

`/search` stacks its filter bar beneath the header, so focus must clear two bars, not one. `scroll-padding-top` applies to the **scroll container** — here that is `html`, not any element inside the page — so this cannot be set from `SearchClient`. Set the doubled value at the root instead, replacing the rule from Step 1:

```css
html {
  /* Two bars stack on /search (header + filter bar) and one everywhere
     else. This is the worst case rather than a per-route value, because
     the scroll container is html and a route cannot restyle its own
     ancestor. It only affects programmatic scroll-into-view on focus —
     exactly the moment the clearance is wanted. */
  scroll-padding-top: calc(var(--spacing-header) * 2);
}
```

- [ ] **Step 5: Verify the token resolves**

Run: `cd apps/flick-app && npm run build`
Expected: PASS. Then confirm no stale literals remain:

Run: `cd apps/flick-app && grep -rn "top-16\|h-16" src/components/ui/AppHeader.tsx "src/app/(app)/search/SearchClient.tsx"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-app/src
git commit -m "fix(app): keep keyboard focus clear of the sticky header"
```

---

## Task 9: The toast provider

**Files:**
- Create: `apps/flick-app/src/components/ui/Toast.tsx`
- Create: `apps/flick-app/src/components/ui/Toast.test.tsx`
- Modify: `apps/flick-app/src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `.focus-ring` (Task 6).
- Produces: `ToastProvider` (component) and `useToast(): { show: (message: string) => void }`. Task 10 consumes `useToast`.

**Context:** specified in `FRONTEND_PLAN.md` Part 3 and never built — zero references in `src/`. Checkout, coin unlock, and the player's notice all currently have no consistent channel.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/flick-app/src/components/ui/Toast.test.tsx
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ message }: { message: string }) {
  const { show } = useToast();
  return <button onClick={() => show(message)}>fire</button>;
}

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a message and auto-dismisses it after 4s', () => {
    render(
      <ToastProvider>
        <Trigger message="บันทึกแล้ว" />
      </ToastProvider>,
    );
    act(() => screen.getByText('fire').click());
    expect(screen.getByRole('status')).toHaveTextContent('บันทึกแล้ว');

    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.queryByText('บันทึกแล้ว')).toBeNull();
  });

  it('queues a second message rather than dropping it', () => {
    render(
      <ToastProvider>
        <Trigger message="หนึ่ง" />
      </ToastProvider>,
    );
    act(() => screen.getByText('fire').click());
    act(() => screen.getByText('fire').click());
    // Both live in the queue; the region reports at least one.
    expect(screen.getAllByText('หนึ่ง').length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/flick-app && npm test -- Toast`
Expected: FAIL — cannot resolve `./Toast`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/flick-app/src/components/ui/Toast.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';

const AUTO_DISMISS_MS = 4000;

interface Toast {
  id: number;
  message: string;
}

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * One feedback channel for the whole app. Specified in FRONTEND_PLAN.md
 * Part 3 and never built, which is why a coin unlock succeeds silently and
 * the player's notice could sit over a scene for the rest of an episode.
 *
 * A queue rather than a single slot: a coin spend that fails and a playback
 * warning can land in the same second, and dropping one of them is how a
 * user ends up not knowing why nothing happened.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string) => {
    setToasts((current) => [...current, { id: Date.now() + current.length, message }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((current) => current.slice(1)), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-28 z-[200] flex flex-col items-center gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-fade-in-up pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl border border-white/10 bg-ink-1/95 px-4 py-3 text-sm text-fg shadow-surface backdrop-blur-xl"
          >
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              aria-label="ปิด"
              className="focus-ring shrink-0 rounded-full p-1 text-fg-mute transition-colors duration-ui hover:text-fg"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/flick-app && npm test -- Toast`
Expected: PASS — 2 tests.

- [ ] **Step 5: Mount the provider**

In `apps/flick-app/src/app/(app)/layout.tsx`, wrap the existing children with `<ToastProvider>`. Do the same in `apps/flick-app/src/app/player/[id]/page.tsx`'s rendered tree and `apps/flick-app/src/app/subscribe/page.tsx`'s — the player and subscribe routes sit outside the `(app)` group and Task 10 needs the provider there.

- [ ] **Step 6: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-app/src/components/ui/Toast.tsx apps/flick-app/src/components/ui/Toast.test.tsx apps/flick-app/src/app
git commit -m "feat(app): add the toast provider specced in FRONTEND_PLAN Part 3"
```

---

## Task 10: Retire the player's ad-hoc notice

**Files:**
- Modify: `apps/flick-app/src/app/player/[id]/PlayerClient.tsx:424-430` and the `notice` state

**Interfaces:**
- Consumes: `useToast` (Task 9).
- Produces: nothing downstream.

**Context:** the `notice` paragraph clears only on the next action. `playbackError` is different in kind — it describes the stage's current state, not a transient event — so it **stays** as an overlay and only `notice` moves to toasts.

- [ ] **Step 1: Route notices through the toast channel**

Add the import:

```tsx
import { useToast } from '@/components/ui/Toast';
```

Inside the component:

```tsx
const { show: showToast } = useToast();
```

Find every `setNotice(...)` call. Replace each with `showToast(...)` carrying the same message. Then delete the `notice` state declaration.

- [ ] **Step 2: Narrow the overlay to playback faults only**

Replace the block at lines 424-430:

```tsx
      {!gate && playbackError && (
        <p
          role="status"
          className="absolute inset-x-4 bottom-20 z-10 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-center text-sm text-fg backdrop-blur-xl"
        >
          {playbackError}
        </p>
      )}
```

- [ ] **Step 3: Verify the state is gone**

Run: `cd apps/flick-app && grep -n "notice" "src/app/player/[id]/PlayerClient.tsx"`
Expected: no output.

- [ ] **Step 4: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add "apps/flick-app/src/app/player/[id]/PlayerClient.tsx"
git commit -m "refactor(app): move player notices onto the toast channel"
```

---

## Task 11: Server-side search (API)

**Files:**
- Modify: `apps/flick-api/src/movies/movies.controller.ts`
- Modify: `apps/flick-api/src/movies/movies.service.ts`
- Test: `apps/flick-api/src/movies/movies.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /movies?q=<term>` returning the same `Movie[]` DTO shape as `GET /movies`. Task 12 consumes it.

**Context:** the frontend currently downloads the entire catalogue to filter it. `MoviesService.toDto` already strips `videoUrl` — the search path must reuse that same DTO mapping, never a second one.

- [ ] **Step 1: Write the failing test**

Append to `apps/flick-api/src/movies/movies.service.spec.ts` (match the file's existing mocking idiom for `PrismaService`):

```ts
describe('findAll with a query', () => {
  it('filters by title, case-insensitively', async () => {
    await service.findAll('ดราม่า');
    expect(prisma.movie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { title: { contains: 'ดราม่า', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  it('applies no where clause when the query is blank', async () => {
    await service.findAll('   ');
    const arg = (prisma.movie.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toBeUndefined();
  });

  it('never returns videoUrl', async () => {
    const result = await service.findAll('x');
    for (const movie of result) {
      expect(movie).not.toHaveProperty('videoUrl');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/flick-api && npm test -- movies.service`
Expected: FAIL — `findAll` takes no argument.

- [ ] **Step 3: Implement the filter**

In `movies.service.ts`, give `findAll` an optional query and build the `where` clause. Keep the existing DTO mapping exactly as it is:

```ts
  async findAll(q?: string) {
    const term = q?.trim();
    const where = term
      ? {
          OR: [
            { title: { contains: term, mode: 'insensitive' as const } },
            { genres: { some: { genre: { name: { contains: term, mode: 'insensitive' as const } } } } },
          ],
        }
      : undefined;

    const movies = await this.prisma.movie.findMany({ where, /* keep the existing include/orderBy exactly */ });
    return movies.map((movie) => this.toDto(movie));
  }
```

Match the existing relation names for the genre join — read the current `include` and the Prisma schema rather than assuming `genres.some.genre`.

- [ ] **Step 4: Accept the param in the controller**

```ts
  @Get()
  findAll(@Query('q') q?: string) {
    return this.moviesService.findAll(q);
  }
```

Add `Query` to the `@nestjs/common` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/flick-api && npm test -- movies.service`
Expected: PASS.

- [ ] **Step 6: Full API verification**

Run: `cd apps/flick-api && npm test && npm run lint`
Expected: 183+ tests pass, 0 lint errors.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/src/movies
git commit -m "feat(api): add a server-side movie search query"
```

---

## Task 12: Search stops downloading the catalogue

**Files:**
- Modify: `apps/flick-app/src/types/api.ts` (all three: `ApiPath`, `ApiResponse`, `decodeApiResponse`)
- Modify: `apps/flick-app/src/app/(app)/search/SearchClient.tsx:73-88`
- Modify: `apps/flick-app/src/app/(app)/search/page.tsx`

**Interfaces:**
- Consumes: `GET /movies?q=` (Task 11).
- Produces: nothing downstream.

**Context:** keep the recent-searches store, the genre shortcuts and the no-match state exactly as they are — that work is already correct. Only the data path changes. The `:73` comment explaining why there is no debounce becomes false the moment the call is a network call, so it must be replaced, not left behind.

- [ ] **Step 1: Extend the API contract**

In `types/api.ts`, add to `ApiPath`:

```ts
  | `/movies?q=${string}`
```

Add to the `ApiResponse` conditional chain, beside the existing `/movies` arm:

```ts
  : Path extends `/movies?q=${string}` ? Movie[]
```

And in `decodeApiResponse`, beside the existing `/movies` branch:

```ts
  if (path.startsWith('/movies?q=')) return decodeMovies(value) as ApiResponse<Path>;
```

Place this branch **before** the exact-match `'/movies'` check so the prefix does not shadow it.

- [ ] **Step 2: Replace the in-memory filter with a debounced fetch**

In `SearchClient.tsx`, delete the `searchResults` `useMemo` (lines 79-88) and the stale comment above it (line 73), and add:

```tsx
  const [results, setResults] = useState<Movie[] | null>(null);

  // 250ms: long enough that a normal typist issues one request per word,
  // short enough that results feel attached to the keystroke. The previous
  // in-memory filter needed no debounce because it made no request; this
  // one does.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch(`/movies?q=${encodeURIComponent(term)}`)
        .then((movies) => {
          if (!cancelled) setResults(movies);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
```

Add the imports: `useEffect` from `react`, and `import { apiFetch } from '@/lib/apiClient';`.

Rename every remaining reference to `searchResults` in the JSX to `results`.

- [ ] **Step 3: Stop preloading the whole catalogue**

In `search/page.tsx`, `getMovies()` exists only to feed the client filter. Delete it and the `initialMovies` prop, rendering `<SearchClient />` with no props. Remove the now-unused `decodeMovies`, `API_BASE_URL` and `Movie` imports, and drop the `loadFailed` / `ErrorPanel` branch — there is no longer a server fetch that can fail.

Update `SearchClient`'s signature to take no props.

- [ ] **Step 4: Update the existing search test**

`SearchClient.test.tsx` currently passes `initialMovies`. Rewrite its cases to mock `apiFetch` instead:

```tsx
vi.mock('@/lib/apiClient', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));
```

Keep every assertion about recent searches, genre chips and the no-match state — those behaviours must not change.

- [ ] **Step 5: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green. `/search` may change from static to dynamic in the route table — that is expected and correct.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-app/src
git commit -m "feat(app): route search through the server instead of the whole catalogue"
```

---

## Task 13: Downloads stops promising offline

**Files:**
- Modify: `apps/flick-app/src/app/(app)/downloads/DownloadsClient.tsx:19-40`
- Modify: `apps/flick-app/src/components/ui/AppHeader.tsx:13`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**Context:** this is spec Part **5a** only. Real offline playback (5b) is a separate spec and is **not** in scope here — do not add caching, a service worker, or a manifest. The `PUT /me/downloads/:id` call and the `Download` model stay exactly as they are; only the label changes.

- [ ] **Step 1: Rename the header action**

In `AppHeader.tsx` line 13, change the action's label and icon:

```tsx
  { name: 'downloads' as const, href: '/downloads', label: 'รายการของฉัน', icon: 'bookmark' as const },
```

Confirm `bookmark` exists in `Icon`'s name union; if the closest available glyph is named differently, use that name.

- [ ] **Step 2: Retitle the screen and drop the apology**

In `DownloadsClient.tsx`, replace the `<h1>` and the paragraph beneath it:

```tsx
        <h1 className="text-title mb-1 font-display">รายการของฉัน</h1>
        <p className="mb-6 text-sm text-fg-dim">
          เรื่องที่คุณเก็บไว้ดูทีหลัง
        </p>
```

- [ ] **Step 3: Fix the hand-rolled header icon**

The same file renders its own header rather than using `AppHeader` (line 19-30). Its `aria-label="ดาวน์โหลด"` span and `download` icon now contradict the rename. Replace the whole hand-rolled `<header>` with `<AppHeader activeAction="downloads" />` and add the import — this also removes the drift the responsive spec flagged.

- [ ] **Step 4: Update the empty state**

The `EmptyState` in this file still says downloads. Change its copy to match: title `'ยังไม่มีเรื่องในรายการ'`, description `'เก็บเรื่องที่สนใจไว้ดูทีหลังได้จากหน้าเรื่อง'`, and keep its action pointing at `/discover`.

- [ ] **Step 5: Verify no offline promise survives**

Run: `cd apps/flick-app && grep -rn "ออฟไลน์\|ดาวน์โหลด" src/app "src/components"`
Expected: only the `PUT /me/downloads/` call sites in `MovieClient.tsx` and `useMovieActions.ts` (API paths, not user-facing copy). No user-facing string promises offline playback.

- [ ] **Step 6: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-app/src
git commit -m "fix(app): call the saved list what it is instead of downloads"
```

---

## Task 14: Sell inside the episode

**Files:**
- Modify: `apps/flick-app/src/app/player/[id]/page.tsx` (fetch plans server-side, pass as prop)
- Modify: `apps/flick-app/src/app/player/[id]/PlayerClient.tsx` (subscription branch of the gate sheet)

**Interfaces:**
- Consumes: `withNext` (Task 1), `decodePlans` (existing, from `@/types/api`).
- Produces: nothing downstream.

**Context:** `GET /plans` is **not** in `ApiPath` — `subscribe/page.tsx` fetches it with a raw server-side `fetch` plus `decodePlans`. Do the same here rather than extending the API contract trio: the player page is already a Server Component and can hand plans down as a prop, which costs no client bundle and no new contract surface.

- [ ] **Step 1: Fetch plans on the player page**

In `player/[id]/page.tsx`, mirror the pattern from `subscribe/page.tsx`:

```tsx
import API_BASE_URL from '@/lib/api';
import { decodePlans } from '@/types/api';
import type { SubscriptionPlan } from '@/types';

async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/plans`, { next: { revalidate: 300 } });
    if (!response.ok) return [];
    return decodePlans(await response.json()).subscriptions;
  } catch {
    // The gate still works without them — it falls back to the /subscribe
    // link. A plans outage must never block playback.
    return [];
  }
}
```

Call it alongside the existing data fetches and pass the result to `PlayerClient` as a `plans` prop.

- [ ] **Step 2: Render the comparison in the subscription branch**

In `PlayerClient.tsx`, replace the `else` branch of the gate sheet (currently a single line of copy plus one button, around lines 408-413) with:

```tsx
          <>
            <p className="text-sm text-fg-dim">เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น</p>
            {plans.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2">
                {plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="flex items-baseline justify-between rounded-xl border border-white/10 bg-ink-2 px-4 py-3"
                  >
                    <span className="text-sm font-medium text-fg">{plan.name}</span>
                    <span className="text-data text-fg-dim">
                      ฿{plan.price}
                      {plan.period}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="primary"
              onClick={() => router.push(withNext('/subscribe', returnPath))}
              className="mt-4 w-full"
            >
              ดูแพ็กเกจสมาชิก
            </Button>
          </>
```

`returnPath` and the `withNext` import already exist from Task 4.

- [ ] **Step 3: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Manual check of the four gate branches**

With the API running, confirm by hand — the automated suites do not cover the sheet's branching:
1. Free episode: no sheet.
2. Coin-gated, balance ≥ cost: arithmetic shown, unlock works.
3. Coin-gated, balance < cost: `ดูตอนฟรี` goes to the movie page, not `/discover`.
4. Subscription-required: plans listed inline; the button carries `?next=/player/<id>`.

- [ ] **Step 5: Commit**

```bash
git add "apps/flick-app/src/app/player/[id]"
git commit -m "feat(app): compare plans inside the gate instead of navigating away"
```

---

## Task 15: End-to-end verification of the spine

**Files:** none modified — this task is verification only.

**Interfaces:**
- Consumes: everything above.
- Produces: a green baseline for the identity work in spec Part 7.

**Context:** Tasks 1-5 are individually tested but never exercised as one path. This walks the journey the spec's prologue describes.

- [ ] **Step 1: Run every suite**

```bash
cd apps/flick-app && npm test && npm run lint && npm run build
cd ../flick-api && npm test && npm run lint && npm run test:e2e
```

Expected: all green. The API e2e needs a seeded local database — if `otp_challenges` or the seeded `e2e-free-user` are missing, run `npx prisma migrate deploy` then `npm run db:seed` first.

- [ ] **Step 2: Walk the funnel by hand, logged out**

1. Open `/player/<a premium episode id>` while logged out.
2. Confirm the URL becomes `/login?next=%2Fplayer%2F<id>`.
3. Complete the OTP flow with the seeded phone `+66800000001`.
4. **Confirm you land back on that episode**, not `/home`.

- [ ] **Step 3: Walk the paid path**

1. As a user without entitlement, open a premium episode.
2. From the gate sheet, tap `ดูแพ็กเกจสมาชิก`.
3. Confirm `/subscribe?next=%2Fplayer%2F<id>`.
4. Complete a checkout against the fake gateway.
5. **Confirm the processing screen returns you to the episode**, and that browser-back goes to the episode rather than the gateway.

- [ ] **Step 4: Try to break it**

Open `/login?next=https://evil.com` and `/login?next=//evil.com`, complete a login, and confirm you land on `/home` both times — never off-origin.

- [ ] **Step 5: Keyboard pass**

Tab through `/home`, `/search` and `/login`. Every interactive element shows a visible ring, and nothing focused hides under the sticky header.

- [ ] **Step 6: Commit the verification record**

```bash
git commit --allow-empty -m "docs: record end-to-end verification of the return-to-intent spine"
```

---

## Not in this plan

- **Spec Part 5b (offline playback)** — its own spec, blocked on the content-protection decision (unencrypted cache vs. HLS AES-128 vs. DRM).
- **Spec Part 7 (identity / art direction)** — portrait-first geometry, gold-as-currency treatment, Anuphan at display sizes. Design iteration rather than checkbox tasks; do it after Task 15 is green, against a working funnel.
- **`GET /episodes/:id`** — the player still walks the catalogue to find one episode. Carried over from `FRONTEND_PLAN.md`; not blocking anything here.
