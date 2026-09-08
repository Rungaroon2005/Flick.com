# Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Flick screen render correctly from 390px to 1920px, with a top nav bar replacing the bottom pill at `lg`.

**Architecture:** Three new primitives (`PageShell`, `Container`, `HeaderNav`) absorb the layout rules that are currently copy-pasted or absent, then each screen gets a small mobile-first breakpoint diff. Navigation switches regime once, at `lg` (1024px): iPhone and iPad-portrait keep the bottom pill, iPad-landscape and desktop get a top bar. No `max-*` variants anywhere — an unprefixed class is always the 390px value.

**Tech Stack:** Next.js 16.2.12 (App Router, React 19.2.4) · Tailwind CSS 4.3.3 (CSS-first `@theme`, no JS config) · Vitest 4 + Testing Library + jsdom

**Spec:** `docs/superpowers/specs/2026-08-17-responsive-layout-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Presentation layer only.** No task changes a data fetch, an entitlement check, an API contract, or playback logic. If a task appears to require it, stop and report.
- **Read the installed Next docs before writing component code.** `apps/flick-app/AGENTS.md`: "This is NOT the Next.js you know." Consult `node_modules/next/dist/docs/` — do not rely on training data for Next 16 APIs.
- **Breakpoints are stock Tailwind v4**, verified in `node_modules/tailwindcss/theme.css:327-331`: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536. Do not add custom breakpoints.
- **Mobile-first only.** No `max-sm:`/`max-md:` variants. Prefixed classes only ever widen the layout.
- **No new dependencies.** This repo has no `clsx`, `cva`, or `tailwind-merge`. Compose classes with template literals and ternaries, matching `AppHeader.tsx:19`, `MovieCard.tsx:29`, `BottomNav.tsx:50`.
- **Preserve every `[@media(hover:hover)]` guard.** They are what keep hover affordances off touch devices, and they matter *more* at iPad-landscape width. Never replace one with a bare `hover:`.
- **CSS budget: 80,000 bytes total** (`performance-budgets.json` → `maxTotalCssBytes`). Baseline at plan time: **67,694 bytes, 12,306 free.** Measured by `npm run performance:check`, enforced in CI.
- **Any `next/image` whose rendered width grows must have its `sizes` widened in the same commit.** Otherwise the browser picks the old narrow rendition and upscales it — a visibly blurrier desktop than today.
- **`<video>` elements may exist only in `PlayerClient.tsx` and `DiscoverClient.tsx`** — enforced by `PLAYBACK_SURFACES` in `scripts/performance-budgets.mjs`. Do not move one into a new component.
- All UI copy is Thai. Reuse existing strings verbatim; do not translate or invent.

**Per-task gate (run before every commit):**

```bash
cd apps/flick-app && npm run lint && npm test
```

---

## File Structure

**Create:**
- `src/components/navItems.ts` — the tab list, shared by both nav renderers
- `src/components/ui/PageShell.tsx` — app ground + bottom-nav offset
- `src/components/ui/Container.tsx` — max-width + gutter scale
- `src/components/ui/HeaderNav.tsx` — desktop nav island (`'use client'`)
- `src/components/ui/PageShell.test.tsx`, `Container.test.tsx`, `HeaderNav.test.tsx`
- `src/components/navConsistency.test.tsx` — cross-renderer invariant

**Modify:** `src/app/globals.css` · `AppHeader.tsx` · `BottomNav.tsx` · `MovieCard.tsx` · `Skeleton.tsx` · the 9 page wrappers · the 5 `loading.tsx` files · all 12 screens

---

## Task 1: Layout tokens and the two container primitives

**Files:**
- Modify: `src/app/globals.css` (the `@theme` block starting line 14)
- Create: `src/components/ui/PageShell.tsx`
- Create: `src/components/ui/Container.tsx`
- Test: `src/components/ui/PageShell.test.tsx`, `src/components/ui/Container.test.tsx`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - CSS tokens `--container-page: 87.5rem` and `--container-reading: 45rem`, yielding the utilities `max-w-page` and `max-w-reading`
  - `export function PageShell({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element`
  - `export function Container({ children, width, className }: { children: React.ReactNode; width?: 'page' | 'reading'; className?: string }): JSX.Element` — `width` defaults to `'page'`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/PageShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageShell } from './PageShell';

describe('PageShell', () => {
  it('renders its children', () => {
    render(<PageShell><p>เนื้อหา</p></PageShell>);
    expect(screen.getByText('เนื้อหา')).toBeInTheDocument();
  });

  // The bottom-nav offset must disappear at lg, where BottomNav is hidden.
  // Without lg:pb-16 every desktop page carries 96px of dead space.
  it('drops the bottom-nav offset at lg', () => {
    const { container } = render(<PageShell><span /></PageShell>);
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain('pb-[calc(96px+env(safe-area-inset-bottom))]');
    expect(shell.className).toContain('lg:pb-16');
  });

  it('appends caller classes', () => {
    const { container } = render(<PageShell className="custom-x"><span /></PageShell>);
    expect((container.firstElementChild as HTMLElement).className).toContain('custom-x');
  });
});
```

Create `src/components/ui/Container.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Container } from './Container';

describe('Container', () => {
  it('defaults to page width with the responsive gutter scale', () => {
    const { container } = render(<Container><span /></Container>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('max-w-page');
    expect(el.className).toContain('px-5');
    expect(el.className).toContain('md:px-8');
    expect(el.className).toContain('lg:px-10');
  });

  // Settings lists and forms must not stretch to 1400px.
  it('uses reading width when asked', () => {
    const { container } = render(<Container width="reading"><span /></Container>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('max-w-reading');
    expect(el.className).not.toContain('max-w-page');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/flick-app && npx vitest run src/components/ui/PageShell.test.tsx src/components/ui/Container.test.tsx
```

Expected: FAIL — `Failed to resolve import "./PageShell"` and `"./Container"`.

- [ ] **Step 3: Add the tokens**

In `src/app/globals.css`, inside the existing `@theme { ... }` block that begins at line 14, directly after the `--color-*` declarations and before the `/* Type scale */` comment, add:

```css
  /* Page width. --container-* is Tailwind v4's namespace for max-w-/w-/min-w-
     utilities (node_modules/tailwindcss/theme.css:333), so these generate
     max-w-page and max-w-reading. Two values on purpose: a poster wall wants
     1400px, but a 13-row settings list stretched that wide is a worse
     settings list — the eye loses the row it is on.
     See docs/superpowers/specs/2026-08-17-responsive-layout-design.md Part 2. */
  --container-page: 87.5rem;
  --container-reading: 45rem;
```

- [ ] **Step 4: Write the primitives**

Create `src/components/ui/PageShell.tsx`:

```tsx
/**
 * The app ground for every full screen. Replaces the wrapper div that was
 * copy-pasted across nine files, each carrying its own bottom-nav offset.
 *
 * The offset exists because BottomNav is position:fixed and would otherwise
 * cover the last row of content. At lg the bottom nav is replaced by the
 * header bar (see HeaderNav), so the offset shrinks to ordinary page padding.
 */
export function PageShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16 ${className}`}
    >
      {children}
    </div>
  );
}
```

Create `src/components/ui/Container.tsx`:

```tsx
const WIDTHS = {
  page: 'max-w-page',
  reading: 'max-w-reading',
} as const;

/**
 * Centers content and owns the gutter scale.
 *
 * IMPORTANT: never wrap a horizontal shelf in this. A shelf scroller carries
 * its own gutter as padding so cards bleed to the viewport edge and the next
 * card peeks — containing it clips that and turns a carousel into a boxed
 * row. For shelves, wrap the section heading only and give the scroller a
 * matching `px-5 md:px-8 lg:px-10`. See HomeClient for the shape.
 */
export function Container({
  children,
  width = 'page',
  className = '',
}: {
  children: React.ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full ${WIDTHS[width]} px-5 md:px-8 lg:px-10 ${className}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/flick-app && npx vitest run src/components/ui/PageShell.test.tsx src/components/ui/Container.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm the tokens compile into real utilities**

```bash
cd apps/flick-app && npm run build 2>&1 | tail -20
grep -c 'max-w-page\|--container-page' .next/static/chunks/*.css
```

Expected: build succeeds; grep returns a non-zero count. If it returns 0, the `@theme` block was edited in the wrong place — the tokens must be in a plain `@theme`, not the `@theme inline` block at line 5 (that one is reserved for values that are themselves `var()` references).

- [ ] **Step 7: Record the CSS baseline**

```bash
cd apps/flick-app && stat -f%z .next/static/chunks/*.css | awk '{s+=$1} END {print "CSS bytes:", s, "of 80000"}'
```

Note the number in the commit body. Expect ~67,700 — the tokens alone add almost nothing.

- [ ] **Step 8: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/globals.css apps/flick-app/src/components/ui/PageShell.tsx apps/flick-app/src/components/ui/Container.tsx apps/flick-app/src/components/ui/PageShell.test.tsx apps/flick-app/src/components/ui/Container.test.tsx
git commit -m "feat(app): add page-width tokens and PageShell/Container primitives"
```

---

## Task 2: Shared nav items, HeaderNav, and the lg regime switch

**Files:**
- Create: `src/components/navItems.ts`
- Create: `src/components/ui/HeaderNav.tsx`
- Create: `src/components/ui/HeaderNav.test.tsx`
- Create: `src/components/navConsistency.test.tsx`
- Modify: `src/components/BottomNav.tsx:7-19` (delete local `NAV_ITEMS`, import instead), `:27` (add `lg:hidden`)
- Modify: `src/components/ui/AppHeader.tsx:17-26` (render `HeaderNav`, fix header height)

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `export interface NavItem { name: string; path: string; icon: IconName; activeIcon: IconName }`
  - `export const NAV_ITEMS: NavItem[]` — the four tabs, unchanged in content and order
  - `export function HeaderNav(): JSX.Element` — `hidden lg:flex`
  - `AppHeader` keeps its existing props (`greeting`, `coinBalance`, `activeAction`, `variant`) and gains a fixed `h-16` at every width

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/HeaderNav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderNav } from './HeaderNav';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));

describe('HeaderNav', () => {
  it('marks the current route with aria-current', () => {
    usePathname.mockReturnValue('/discover');
    render(<HeaderNav />);
    expect(screen.getByRole('link', { name: /แนะนำ/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /หน้าหลัก/ })).not.toHaveAttribute('aria-current');
  });

  // Hidden below lg: the bottom pill owns navigation on phone and
  // iPad-portrait, and two navs on one screen is a bug, not a fallback.
  it('is hidden below lg', () => {
    usePathname.mockReturnValue('/home');
    const { container } = render(<HeaderNav />);
    const nav = container.querySelector('nav') as HTMLElement;
    expect(nav.className).toContain('hidden');
    expect(nav.className).toContain('lg:flex');
  });
});
```

Create `src/components/navConsistency.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderNav } from './ui/HeaderNav';
import BottomNav from './BottomNav';
import { NAV_ITEMS } from './navItems';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));

/**
 * The two renderers must never disagree about what the tabs are. Adding a
 * fifth tab to one and not the other is a silent failure: it only shows up
 * on one class of device.
 */
describe('navigation sources', () => {
  it('renders the same destinations in both regimes', () => {
    usePathname.mockReturnValue('/home');
    const expected = NAV_ITEMS.map((item) => item.path).sort();

    const header = render(<HeaderNav />);
    const headerPaths = [...header.container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href'))
      .sort();
    header.unmount();

    const bottom = render(<BottomNav />);
    const bottomPaths = [...bottom.container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href'))
      .sort();
    bottom.unmount();

    expect(headerPaths).toEqual(expected);
    expect(bottomPaths).toEqual(expected);
  });

  it('hides the bottom pill at lg', () => {
    usePathname.mockReturnValue('/home');
    const { container } = render(<BottomNav />);
    expect((container.querySelector('nav') as HTMLElement).className).toContain('lg:hidden');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/flick-app && npx vitest run src/components/ui/HeaderNav.test.tsx src/components/navConsistency.test.tsx
```

Expected: FAIL — cannot resolve `./navItems` and `./ui/HeaderNav`.

- [ ] **Step 3: Extract the shared nav items**

Create `src/components/navItems.ts` — content moved verbatim from `BottomNav.tsx:7-19`:

```ts
import type { IconName } from './ui/Icon';

export interface NavItem {
  name: string;
  path: string;
  icon: IconName;
  activeIcon: IconName;
}

/**
 * The tab set, shared by BottomNav (below lg) and HeaderNav (lg and up).
 * One source of truth on purpose: a tab added to only one renderer is
 * invisible on half the devices and passes every screen it is tested on.
 */
export const NAV_ITEMS: NavItem[] = [
  { name: 'หน้าหลัก', path: '/home', icon: 'home', activeIcon: 'homeFilled' },
  { name: 'แนะนำ', path: '/discover', icon: 'discover', activeIcon: 'discoverFilled' },
  { name: 'บันทึก', path: '/bookmarks', icon: 'bookmark', activeIcon: 'bookmarkFilled' },
  { name: 'โปรไฟล์', path: '/profile', icon: 'profile', activeIcon: 'profileFilled' },
];
```

- [ ] **Step 4: Write HeaderNav**

Create `src/components/ui/HeaderNav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '../navItems';
import { Icon } from './Icon';

/**
 * Desktop navigation, hosted inside AppHeader. Appears at lg (1024px), which
 * is the layout-regime boundary, not a device boundary: iPad landscape and
 * desktop get the bar; iPhone and iPad portrait keep the thumb-reachable
 * bottom pill. Item heights are kept inside AppHeader's fixed h-16 so the
 * sticky offsets on /search stay correct.
 */
export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก" className="hidden lg:flex lg:items-center lg:gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium no-underline transition-colors duration-ui ${
              isActive
                ? 'bg-brand/15 text-brand-ink'
                : 'text-fg-mute [@media(hover:hover)]:hover:bg-white/5 [@media(hover:hover)]:hover:text-fg'
            }`}
          >
            <Icon name={isActive ? item.activeIcon : item.icon} size={18} />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Point BottomNav at the shared list and hide it at lg**

In `src/components/BottomNav.tsx`, delete the `NavItem` interface and the local `NAV_ITEMS` const (lines 7-19), and replace the `Icon` import line with:

```tsx
import { Icon } from './ui/Icon';
import { NAV_ITEMS } from './navItems';
```

Then change the `<nav>` className on line 27 from:

```tsx
className="fixed inset-x-4 z-[1000] flex justify-center"
```

to:

```tsx
className="fixed inset-x-4 z-[1000] flex justify-center lg:hidden"
```

- [ ] **Step 6: Host the nav in AppHeader and fix its height**

In `src/components/ui/AppHeader.tsx`, add the import:

```tsx
import { HeaderNav } from './HeaderNav';
```

Replace the `<header>` className (line 19) — `py-4` becomes an explicit `h-16`:

```tsx
      className={`sticky top-0 z-[100] flex h-16 items-center justify-between px-5 backdrop-blur-sm md:px-8 lg:px-10 ${
```

Then insert `<HeaderNav />` between the logo block (closing `</div>` on line 26) and the actions block (`<div className="flex items-center gap-3">` on line 27).

Add this comment directly above the `<header>` tag:

```tsx
  // h-16 is fixed at every width and is load-bearing: SearchClient's filter
  // bar sticks at top-16 against it. Changing this height means changing
  // that offset in the same commit.
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd apps/flick-app && npx vitest run src/components/ui/HeaderNav.test.tsx src/components/navConsistency.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/components/
git commit -m "feat(app): add desktop HeaderNav and switch nav regime at lg"
```

---

## Task 3: Adopt AppHeader on /profile and /downloads

**Files:**
- Modify: `src/app/(app)/profile/page.tsx:71-90` (delete the hand-rolled header)
- Modify: `src/app/(app)/downloads/DownloadsClient.tsx:16-30` (delete the hand-rolled header)

**Interfaces:**
- Consumes: `AppHeader` from Task 2 (now renders `HeaderNav` and is `h-16`)
- Produces: nothing new

**Why:** both files render a byte-for-byte copy of `AppHeader`'s logo and two action buttons, already drifting (`px-5` vs `px-4`, `sticky` vs not). Without this task those two screens are the only tab routes with no desktop nav.

- [ ] **Step 1: Replace the profile header**

In `src/app/(app)/profile/page.tsx`, delete the entire `<header>` element (lines 71-90) and put in its place:

```tsx
      <AppHeader />
```

Add the import at the top of the file:

```tsx
import { AppHeader } from '@/components/ui/AppHeader';
```

Then remove the now-unused `Link` import **only if** no other `Link` remains in the file — check first with `grep -c '<Link' src/app/\(app\)/profile/page.tsx`.

- [ ] **Step 2: Replace the downloads header**

In `src/app/(app)/downloads/DownloadsClient.tsx`, delete the entire `<header>` element (lines 16-30) and put in its place:

```tsx
      <AppHeader activeAction="downloads" />
```

`activeAction="downloads"` preserves the current behaviour where the download icon renders as a non-link active pill on its own page. Add:

```tsx
import { AppHeader } from '@/components/ui/AppHeader';
```

Remove `Icon` and `Link` imports **only if** unused elsewhere in the file — verify with grep before deleting.

- [ ] **Step 3: Verify nothing else referenced the deleted markup**

```bash
cd apps/flick-app && npm run lint
```

Expected: no `no-unused-vars` errors. If there are, an import needs removing.

- [ ] **Step 4: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/\(app\)/profile/page.tsx apps/flick-app/src/app/\(app\)/downloads/DownloadsClient.tsx
git commit -m "refactor(app): replace duplicated headers with AppHeader"
```

---

## Task 4: Adopt PageShell across all nine wrappers

**Files (all nine carry the identical wrapper div):**
- Modify: `src/app/(app)/home/page.tsx:52`, `src/app/(app)/home/loading.tsx:5`
- Modify: `src/app/(app)/bookmarks/page.tsx:31`, `src/app/(app)/bookmarks/loading.tsx:5`
- Modify: `src/app/(app)/search/SearchClient.tsx:93`, `src/app/(app)/search/loading.tsx:5`
- Modify: `src/app/(app)/downloads/DownloadsClient.tsx:15`, `src/app/(app)/downloads/loading.tsx:5`
- Modify: `src/app/(app)/profile/page.tsx:70`
- Test: `src/components/ui/noStrayShell.test.ts` (create)

**Interfaces:**
- Consumes: `PageShell` from Task 1
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/noStrayShell.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vitest runs this as ESM, where __dirname does not exist. vitest.config.ts
// resolves paths the same way.
const here = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const target = path.join(dir, entry);
    if (statSync(target).isDirectory()) return sourceFiles(target);
    return /\.tsx$/.test(target) ? [target] : [];
  });
}

/**
 * The bottom-nav offset must live in exactly one place. Nine copies is how
 * it got out of sync in the first place, and a stray copy silently keeps
 * 96px of dead space at desktop width where the bottom nav does not exist.
 */
describe('page shell', () => {
  it('has no hand-rolled bottom-nav offsets left', () => {
    const offenders = sourceFiles(path.resolve(here, '../../'))
      // Excludes PageShell.tsx (the real implementation, which legitimately
      // contains the string) AND PageShell.test.tsx (Task 1's test asserts
      // the string as a literal) — endsWith('PageShell.tsx') alone matches
      // only the former and leaves the latter to trip this test forever.
      .filter((file) => !path.basename(file).startsWith('PageShell'))
      .filter((file) => readFileSync(file, 'utf8').includes('pb-[calc(96px+env(safe-area-inset-bottom))]'))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/flick-app && npx vitest run src/components/ui/noStrayShell.test.ts
```

Expected: FAIL, listing all nine files.

- [ ] **Step 3: Convert all nine**

In each file, replace the opening tag:

```tsx
<div className="min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]">
```

with:

```tsx
<PageShell>
```

and its matching closing `</div>` with `</PageShell>`. Add to each file:

```tsx
import { PageShell } from '@/components/ui/PageShell';
```

Take care to close the *correct* `</div>` — in `SearchClient.tsx` and `DownloadsClient.tsx` the wrapper is the outermost element, so it is the final `</div>` before the closing paren of the return.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd apps/flick-app && npx vitest run src/components/ui/noStrayShell.test.ts
```

Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/
git commit -m "refactor(app): route every page wrapper through PageShell"
```

---

## Task 5: Responsive card widths and the `sizes` correctness pass

**Files:**
- Modify: `src/features/catalog/components/MovieCard.tsx:16-21` (widths), `:51` (`sizes`)
- Modify: `src/components/ui/Skeleton.tsx:23`
- Test: `src/features/catalog/components/MovieCard.test.tsx` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `MovieCard` keeps its exact prop signature (`movie`, `size?: 'small' | 'medium' | 'large' | 'fill'`, `showBookmark?`). Only class strings and the `sizes` attribute change.

**Why this precedes the screen tasks:** every shelf and grid renders `MovieCard`. Widening cards per-screen would mean editing the same component from four tasks.

- [ ] **Step 1: Write the failing test**

Create `src/features/catalog/components/MovieCard.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MovieCard from './MovieCard';
import type { Movie } from '@/types';

const movie = {
  id: 'm1',
  title: 'เรื่องทดสอบ',
  posterUrl: '/posters/sathu.jpg',
  year: 2026,
  genres: [],
  seasons: [],
} as unknown as Movie;

describe('MovieCard', () => {
  // The blurriness regression: growing the rendered card without growing the
  // sizes hint makes the browser pick the old narrow rendition and upscale
  // it, so desktop ends up visibly worse than before the responsive pass.
  it('declares a sizes hint that covers desktop widths', () => {
    const { container } = render(<MovieCard movie={movie} size="medium" />);
    const sizes = (container.querySelector('img') as HTMLImageElement).getAttribute('sizes') ?? '';
    expect(sizes).toContain('min-width: 1280px');
    expect(sizes).toMatch(/2[0-9]{2}px/);
  });

  it('grows the medium card at md and xl', () => {
    const { container } = render(<MovieCard movie={movie} size="medium" />);
    const className = (container.firstElementChild as HTMLElement).className;
    expect(className).toContain('md:w-[160px]');
    expect(className).toContain('xl:w-[180px]');
  });

  it('leaves fill cards to their grid', () => {
    const { container } = render(<MovieCard movie={movie} size="fill" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('w-full');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/flick-app && npx vitest run src/features/catalog/components/MovieCard.test.tsx
```

Expected: FAIL on the `sizes` assertion (current value is `(max-width: 480px) 160px, 200px`).

- [ ] **Step 3: Widen the cards**

In `MovieCard.tsx`, replace the `sizeClasses` map (lines 16-21):

```tsx
// Cards grow with the viewport rather than multiplying into a hairline row:
// a shelf should show ~1.5 cards on a phone and ~6 at desktop, not 12.
// Every width here is mirrored by the sizes hint below — change both or the
// browser serves an upscaled small rendition.
const sizeClasses = {
  small: 'w-[110px] md:w-[124px] xl:w-[136px]',
  medium: 'w-[140px] md:w-[160px] xl:w-[180px]',
  large: 'w-[160px] md:w-[184px] xl:w-[208px]',
  fill: 'w-full',
};
```

- [ ] **Step 4: Widen the `sizes` hint**

Replace line 51:

```tsx
          sizes="(min-width: 1280px) 220px, (min-width: 1024px) 200px, (min-width: 768px) 184px, 160px"
```

The largest value (220px) covers both the widest fixed card (`large` at `xl` = 208px) and the widest grid cell (a 6-column `fill` card inside a 1400px container ≈ 210px).

- [ ] **Step 5: Match the skeleton to the real card**

In `src/components/ui/Skeleton.tsx`, line 23, replace:

```tsx
        <SkeletonPoster key={i} className="w-[42vw] max-w-40 shrink-0" />
```

with:

```tsx
        <SkeletonPoster key={i} className="w-[42vw] max-w-40 shrink-0 md:w-[160px] md:max-w-none xl:w-[180px]" />
```

A skeleton that does not track its real card's width produces a layout jump on every desktop load, which is worse than no skeleton.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/flick-app && npx vitest run src/features/catalog/components/MovieCard.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/features/catalog/components/MovieCard.tsx apps/flick-app/src/features/catalog/components/MovieCard.test.tsx apps/flick-app/src/components/ui/Skeleton.tsx
git commit -m "feat(app): responsive card widths with matching image sizes hints"
```

---

## Task 6: /home — hero, shelves, and skeleton

**Files:**
- Modify: `src/app/(app)/home/HomeClient.tsx:69` (hero row), `:71,77` (poster + sizes), `:117` (shelf container), `:126,144,186` (shelf gutters), `:156,161` (continue-watching card + sizes)
- Modify: `src/app/(app)/home/loading.tsx:15`

**Interfaces:**
- Consumes: `Container` (Task 1), responsive `MovieCard` (Task 5)
- Produces: nothing new

**Note:** `/home` is the one screen with existing responsive rules. Widen them; do not rewrite them.

- [ ] **Step 1: Widen the hero**

Line 69 — replace `max-w-4xl` with `max-w-page` and add the `lg` gutter:

```tsx
          <div className="relative mx-auto flex max-w-page flex-col items-center gap-5 px-5 pt-6 text-center md:flex-row md:justify-center md:gap-10 md:px-8 md:text-left lg:px-10">
```

Line 71 — add an `xl` height step to the poster:

```tsx
              <div className="relative aspect-[9/16] w-48 shrink-0 overflow-hidden rounded-[28px] ring-1 ring-white/15 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] sm:w-60 md:h-[380px] md:w-auto lg:h-[420px] xl:h-[460px]">
```

Line 77 — widen the hint to match. The card is height-driven
(`aspect-[9/16]`, `w-auto` from `md` up), so rendered width is
`height * 9/16`, not the height token itself — md 380px tall → 214px wide,
lg 420px → 236px, xl 460px → 259px:

```tsx
                  sizes="(min-width: 1280px) 259px, (min-width: 1024px) 237px, (min-width: 768px) 214px, (min-width: 640px) 240px, 192px"
```

- [ ] **Step 2: Widen the shelf column**

Line 117 — `max-w-5xl` becomes `max-w-page`:

```tsx
      <div className="mx-auto flex w-full max-w-page flex-col gap-10 sm:gap-14">
```

Each section heading row (lines 120, 140, 179) — change `px-5` to `px-5 md:px-8 lg:px-10`.

Each shelf scroller (lines 126, 144, 186) — change `px-5` to `px-5 md:px-8 lg:px-10`. Do **not** wrap these in `Container`: the scroller's padding is what lets cards bleed to the edge and the next card peek.

The empty-bookmarks paragraph (line 196) — `px-5` becomes `px-5 md:px-8 lg:px-10`.

- [ ] **Step 3: Widen the continue-watching card**

Line 156 — replace `w-[190px]` with:

```tsx
                    className="group flex w-[190px] shrink-0 snap-start flex-col gap-1 text-[13px] text-fg md:w-[240px] xl:w-[280px]"
```

Line 161 — replace `sizes="190px"`:

```tsx
                          sizes="(min-width: 1280px) 280px, (min-width: 768px) 240px, 190px"
```

- [ ] **Step 4: Match the skeleton**

In `src/app/(app)/home/loading.tsx`, line 15, replace `max-w-5xl` with `max-w-page`.

- [ ] **Step 5: Verify in the browser**

Start the dev server if it is not running (`npm run dev` from the repo root), then load `http://localhost:3000/home` at 390, 834, 1194 and 1440.

Expected at each width:
- 390: unchanged from before this task — 1.5 cards visible per shelf, stacked hero.
- 834: hero still stacked, ~3.5 cards, 32px gutters.
- 1194: hero side-by-side, top nav bar present, bottom pill absent, ~5 cards.
- 1440: content capped at 1400px and centered, ~6 cards.

Then confirm no image is upscaled:

```js
[...document.querySelectorAll('img')]
  .filter((i) => i.naturalWidth && i.naturalWidth < i.getBoundingClientRect().width)
  .map((i) => i.src);
```

Expected: `[]`.

- [ ] **Step 6: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/\(app\)/home/
git commit -m "feat(app): responsive /home hero, shelves and skeleton"
```

---

## Task 7: /search and /bookmarks — poster grids

**Files:**
- Modify: `src/app/(app)/search/SearchClient.tsx:97` (sticky bar), `:122` (results gutter), `:149` (grid)
- Modify: `src/app/(app)/bookmarks/BookmarksClient.tsx:18` (grid)
- Modify: `src/app/(app)/bookmarks/page.tsx:34` (main gutter), `src/app/(app)/bookmarks/loading.tsx`, `src/app/(app)/search/loading.tsx`

**Interfaces:**
- Consumes: `Container` (Task 1), responsive `MovieCard` (Task 5)
- Produces: nothing new

- [ ] **Step 1: Widen the search grid and its chrome**

`SearchClient.tsx` line 149 — extend the column ladder:

```tsx
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
```

Line 97 — the sticky filter bar keeps `top-16` (AppHeader is `h-16` at every width, Task 2) but needs the container and gutter scale:

```tsx
        <div className="sticky top-16 z-[99] mx-auto w-full max-w-page bg-ink px-5 pt-2 pb-6 md:px-8 lg:px-10">
```

Line 122 — the results wrapper:

```tsx
        <div className="animate-fade-in mx-auto w-full max-w-page px-5 md:px-8 lg:px-10">
```

- [ ] **Step 2: Widen the bookmarks grid**

`BookmarksClient.tsx` line 18:

```tsx
    <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
```

`bookmarks/page.tsx` line 34 — wrap the `<main>` content:

```tsx
      <Container>
        <h1 className="text-title mb-6 font-display">บันทึก</h1>
        <BookmarksClient movies={movies} />
      </Container>
```

replacing `<main className="px-4">`. Keep it a `<main>` by passing the element through `Container`'s wrapper div — i.e. render `<main><Container>…</Container></main>`, so the landmark role is preserved. Add `import { Container } from '@/components/ui/Container';`.

- [ ] **Step 3: Match both skeletons**

In `search/loading.tsx` and `bookmarks/loading.tsx`, find the grid or shelf placeholder and apply the same column ladder as its real screen (`grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`) plus `mx-auto w-full max-w-page px-5 md:px-8 lg:px-10` on the wrapper. Read each file first — they are ~26 lines each and their existing structure differs.

- [ ] **Step 4: Verify in the browser**

Load `/search` (type a query that returns results) and `/bookmarks` at 390, 834, 1194, 1440.

Expected column counts: 3 / 4 / 5 / 6. On `/search`, scroll and confirm the filter bar sticks flush under the header with no gap or overlap at every width — that is the `top-16` / `h-16` coupling.

- [ ] **Step 5: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/\(app\)/search/ apps/flick-app/src/app/\(app\)/bookmarks/
git commit -m "feat(app): responsive poster grids on /search and /bookmarks"
```

---

## Task 8: /profile and /downloads — reading width

**Files:**
- Modify: `src/app/(app)/profile/page.tsx:91` (main), and the settings rows at `:145`
- Modify: `src/app/(app)/downloads/DownloadsClient.tsx:32` (main), `:50` (rows)
- Modify: `src/app/(app)/downloads/loading.tsx`

**Interfaces:**
- Consumes: `Container` with `width="reading"` (Task 1)
- Produces: nothing new

- [ ] **Step 1: Constrain profile**

`profile/page.tsx` — replace `<main className="px-5">` (line 91) with:

```tsx
      <main>
        <Container width="reading">
```

and close with `</Container></main>`. Add `import { Container } from '@/components/ui/Container';`.

The settings rows at line 145 carry their own `px-5`; since they now sit inside a container that supplies the gutter, remove `px-5` from that className and keep the vertical padding (`py-4`).

- [ ] **Step 2: Constrain downloads**

`DownloadsClient.tsx` — replace `<main className="px-4">` (line 32) with the same `<main><Container width="reading">` pairing, closing correspondingly.

- [ ] **Step 3: Match the skeleton**

`downloads/loading.tsx` — wrap its placeholder rows in `mx-auto w-full max-w-reading px-5 md:px-8 lg:px-10` so the skeleton and the real list share a left edge.

- [ ] **Step 4: Verify in the browser**

Load `/profile` and `/downloads` at 390, 834, 1194, 1440.

Expected: rows stop widening at 720px and centre; at 1440 there is generous space either side and **the row text is still left-aligned to the container, not the viewport**. Confirm the top nav is present at 1194 and 1440 — this is the check that Task 3 actually landed on these two screens.

- [ ] **Step 5: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/\(app\)/profile/ apps/flick-app/src/app/\(app\)/downloads/
git commit -m "feat(app): constrain /profile and /downloads to reading width"
```

---

## Task 9: /subscribe, /login, /register, and the landing page

**Files:**
- Modify: `src/app/subscribe/SubscribeClient.tsx:27` (header), `:38` (plans section), `:44` (plan list), `:97,99` (coin packs)
- Modify: `src/app/login/page.tsx:59`, `src/app/register/page.tsx:113`
- Modify: `src/app/LandingClient.tsx:51` (headline), `:77` (hero card), `:92` (subtitle)

**Interfaces:**
- Consumes: `Container` (Task 1)
- Produces: nothing new

These four screens sit outside the `(app)` route group and have no nav at any width — correct, and unchanged by this task.

- [ ] **Step 1: Lay the plans out side by side**

`SubscribeClient.tsx` line 44 — plans stack on phone, sit in a row from `md`:

```tsx
        <div className="flex flex-col gap-5 md:grid md:grid-cols-3 md:items-start">
```

Line 99 — coin packs go from 3 to 6 across:

```tsx
        <div className="mt-4 grid grid-cols-3 gap-3 md:grid-cols-6">
```

Wrap the header (line 27) and both `<section>`s (lines 38, 97) in `<Container>`, removing their `px-5` in favour of the container's gutter.

- [ ] **Step 2: Widen the auth cards**

`login/page.tsx:59` and `register/page.tsx:113` — both are `w-full max-w-sm`. Add one step:

```tsx
      <div className="mt-7 w-full max-w-sm rounded-2xl border border-hairline bg-ink-1/70 p-6 backdrop-blur-xl md:max-w-md">
```

- [ ] **Step 3: Scale the landing page**

`LandingClient.tsx` line 51 — the headline is the page's one typographic moment and should grow with the screen:

```tsx
          <h1 className="bg-gradient-to-b from-white to-brand-ink bg-clip-text font-display text-[4rem] leading-[0.82] font-extrabold tracking-tight text-transparent md:text-[5rem] lg:text-[6rem]">
```

Line 77 — the hero card and its poster hint:

```tsx
            <div className="animate-card-peek relative z-10 aspect-[9/16] w-48 shrink-0 overflow-hidden rounded-[28px] ring-1 ring-white/15 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] md:w-56 lg:w-64">
```

and on its `<Image>` (line 78) replace `sizes="192px"` with `sizes="(min-width: 1024px) 256px, (min-width: 768px) 224px, 192px"`.

Line 92 — let the subtitle breathe:

```tsx
        <p className="max-w-[240px] text-center text-sm text-fg-dim md:max-w-sm md:text-base">
```

The two flanking coverflow cards (lines 62, 70) use inline `translateX(±112px)` transforms sized for the 192px hero. With the hero at 256px they will overlap it at `lg`. Change both inline transforms to use a CSS variable set per breakpoint, or simplest: leave the transforms and add `md:hidden` to neither — instead widen the offsets by switching the two `style` transforms to `translateX(-140px)` / `translateX(140px)` and accept a slightly wider fan at all sizes. **Verify this specific overlap at 1194 in Step 4; it is the one change here most likely to need a second pass.**

- [ ] **Step 4: Verify in the browser**

Load `/`, `/login`, `/register`, `/subscribe` at 390, 834, 1194, 1440.

Expected: landing headline scales without wrapping mid-word and the fan cards never overlap the hero card; auth cards widen once at `md` then stop; subscribe shows 1 plan column on phone and 3 from `md`, with coin packs at 3 then 6.

- [ ] **Step 5: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/subscribe/ apps/flick-app/src/app/login/ apps/flick-app/src/app/register/ apps/flick-app/src/app/LandingClient.tsx
git commit -m "feat(app): responsive landing, auth and subscribe screens"
```

---

## Task 10: /movie — two-column detail at lg

**Files:**
- Modify: `src/app/movie/[id]/MovieClient.tsx:69` (root), `:81` (poster), `:89` (title block), `:125-231` (right column), `:197` (episode thumb sizes)

**Interfaces:**
- Consumes: `Container` (Task 1), responsive `MovieCard` (Task 5)
- Produces: nothing new

**Approach:** group the existing children into two wrappers without reordering them. Below `lg` the two wrappers stack in exactly today's order, so the phone layout is unchanged by construction; at `lg` they become grid columns.

- [ ] **Step 1: Group into two columns**

Immediately inside the `<div className="min-h-dvh bg-ink pb-10">` root (line 69), open a grid wrapper:

```tsx
      <div className="mx-auto w-full max-w-page lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-10 lg:px-10 lg:pt-8">
```

**Column A** wraps the existing poster block (line 81) and title/actions block (line 89):

```tsx
        <div className="lg:sticky lg:top-8 lg:self-start">
```

**Column B** wraps everything from the description block (line 125) through the "similar" shelf (line 231):

```tsx
        <div className="min-w-0">
```

Close both, then the grid wrapper, before the `{showInfo && ...}` line.

- [ ] **Step 2: Un-bleed the poster at lg**

Line 81 — the poster is full-bleed on phone and column-constrained at `lg`:

```tsx
      <div className="relative aspect-[2/3] max-h-[70vh] w-full overflow-hidden lg:max-h-none lg:rounded-3xl">
```

Line 89 — the `-mt-10` overlap is a phone effect; cancel it inside the column:

```tsx
      <div className="relative z-10 -mt-10 px-5 md:px-8 lg:mt-6 lg:px-0">
```

- [ ] **Step 3: Neutralise the inner gutters at lg**

Column B's children each carry `px-5` (lines 125, 138, 179, 225, 226). Change each to `px-5 md:px-8 lg:px-0` — the grid wrapper supplies the gutter at `lg`.

- [ ] **Step 4: Widen the episode thumbnail**

Line 190 — the thumb grows with the wider row:

```tsx
                <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-ink-2 md:w-36 lg:w-40">
```

Line 197 — matching hint:

```tsx
                        sizes="(min-width: 1024px) 160px, (min-width: 768px) 144px, 112px"
```

- [ ] **Step 5: Verify in the browser, including the transition**

Load a movie page at 390, 834, 1194, 1440.

Expected: identical to today at 390 and 834; two columns at 1194 and 1440 with the poster column sticking as the episode list scrolls.

Then verify the shared-element transition still works — it is keyed on `episode-${id}` (not position), but reflow is the plausible way to break it: at 1194, click an episode and confirm the thumbnail morphs into the player stage rather than hard-cutting.

- [ ] **Step 6: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/movie/
git commit -m "feat(app): two-column /movie detail at lg"
```

---

## Task 11: /player — bind chrome to the stage

**Files:**
- Modify: `src/app/player/[id]/PlayerClient.tsx:174-198` (Zone A), `:251` (Zone C), `:295-333` (Zone B)

**Interfaces:**
- Consumes: nothing
- Produces: nothing new

**The defect:** Zones A and B are `absolute inset-x-0` on the *root*, so at 1440px the title and scrub bar span 1440px around a ~430px video. The stage (`:202`) is already `h-full [aspect-ratio:9/16] max-w-full`, which self-centres correctly and needs no geometry change.

**The fix:** move Zones A and B *inside* the stage element. On a phone the stage is clamped by `max-w-full` to the full viewport width, so this is a no-op below `lg`; on desktop the chrome inherits the stage's box for free — with no viewport arithmetic, which `docs/FRONTEND_PLAN.md:180-183` specifically warns against.

- [ ] **Step 1: Move Zone A and Zone B inside the stage**

Cut the Zone A block (lines 174-198) and the Zone B block (lines 295-333) and paste both inside `<div className="relative h-full max-w-full [aspect-ratio:9/16]">` (line 202), after the Zone C rail. Their existing `absolute inset-x-0 top-0` / `bottom-0` classes now resolve against the stage instead of the root. Do not change those classes.

- [ ] **Step 2: Stop chrome clicks from toggling chrome**

The stage's parent carries `onClick={recallChrome}` (line 201). Now that the chrome lives inside it, every button press would also bubble up and toggle visibility. Add to **both** the Zone A and Zone B wrapper divs:

```tsx
        onClick={(event) => event.stopPropagation()}
```

This mirrors the `event.stopPropagation()` the Zone C buttons already use (lines 261, 274, 281).

- [ ] **Step 3: Move the rail into the pillar at lg**

Line 251 — below `lg` the rail overlays the stage's right edge as today; at `lg` it moves just outside it, into the pillarbox:

```tsx
          <div className="absolute top-1/2 right-3 z-10 flex -translate-y-1/2 flex-col gap-5 lg:right-auto lg:left-full lg:ml-6">
```

**Deviation on record:** `docs/FRONTEND_PLAN.md:231` says "left-pillar." This places the rail in the **right** pillar instead, so like/bookmark/download stay on the same side as the phone layout and do not jump across the video when a window is resized. Flag this in the commit body; revert to `lg:right-full lg:mr-6` if the original call is preferred.

- [ ] **Step 4: Verify in the browser**

Load a player page at 390, 834, 1194, 1440.

Expected at 390 and 834: **pixel-identical to before this task** — this is the main risk and the main check.
Expected at 1194 and 1440: title and scrub bar span only the video's width, not the viewport; the reaction rail sits in the pillarbox beside the video.

Then verify the auto-hide still works at every width: play, wait 2.5s, confirm Zones A and B fade while the rail persists; tap to recall; confirm buttons inside the chrome fire their own action without toggling chrome (Step 2's fix).

- [ ] **Step 5: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/player/
git commit -m "feat(app): bind player chrome to the stage box on wide viewports"
```

---

## Task 12: /discover — centered stage at lg

**Files:**
- Modify: `src/app/(app)/discover/DiscoverClient.tsx:256-265` (backdrop poster), `:270` (video fit), `:334` (caption/rail)

**Interfaces:**
- Consumes: nothing
- Produces: nothing new

**The defect:** the slide video is `object-cover` on a `w-full` box. At 1194px that crops a 9:16 source to a landscape box and cuts off heads — a content defect, not merely wasted space.

- [ ] **Step 1: Letterbox the video at lg**

Line 270 — `object-contain` centres the 9:16 source inside the full-bleed slide with no geometry maths:

```tsx
          className="absolute inset-0 h-full w-full object-cover lg:object-contain"
```

- [ ] **Step 2: Turn the poster into the pillarbox wash**

Lines 256-264 — the same poster that is the sharp backdrop on phone becomes the ambient bleed behind the letterboxed video at `lg`, matching the treatment `LandingClient.tsx:30` and `PlayerClient.tsx:169` already use:

```tsx
          className="object-cover lg:scale-110 lg:blur-2xl lg:brightness-[0.4]"
```

- [ ] **Step 3: Re-anchor the caption and rail**

Line 334 — `pb-24` exists to clear the bottom nav, which is gone at `lg`; and the caption should not span 1440px:

```tsx
      <div className="absolute inset-x-0 bottom-0 z-10 mx-auto flex max-w-3xl items-end justify-between gap-4 px-4 pb-24 lg:pb-8">
```

- [ ] **Step 4: Verify in the browser, gestures included**

Load `/discover` at 390, 834, 1194, 1440.

Expected at 390 and 834: unchanged. At 1194 and 1440: video letterboxed to 9:16 and centred, blurred wash filling the pillars, no cropped heads.

Then confirm the interaction model survived — none of it was touched, so any change is a regression:
- Vertical snap-scroll advances one slide at a time.
- Only the on-screen slide plays (`IntersectionObserver` at `:76`).
- Mouse-drag rightward opens `/movie/[id]` (the handlers are PointerEvents, so they work with a mouse).
- The mute toggle still works.

- [ ] **Step 5: Gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test
git add apps/flick-app/src/app/\(app\)/discover/
git commit -m "feat(app): centre the /discover feed stage on wide viewports"
```

---

## Task 13: Full-matrix verification sweep

**Files:**
- Modify: only files with defects found during the sweep
- Create: `docs/superpowers/plans/2026-08-17-responsive-verification.md` (the results table)

**Interfaces:**
- Consumes: every preceding task
- Produces: a verification record

- [ ] **Step 1: Build and check the budgets**

```bash
cd apps/flick-app && npm run build && npm run performance:check
```

Expected: all PASS. **`maxTotalCssBytes` is the one at risk** — baseline 67,694 of 80,000, and this plan adds several hundred utility classes. If it fails, do not raise the budget: consolidate repeated gutter triples (`px-5 md:px-8 lg:px-10`) into a single `@utility page-gutter` in `globals.css` and use it everywhere, which collapses many duplicate declarations into one.

- [ ] **Step 2: Screenshot every screen at every width**

For each width in 390, 834, 1194, 1440 (then 1920 as a spot-check), capture: `/`, `/login`, `/register`, `/home`, `/discover`, `/search`, `/bookmarks`, `/downloads`, `/profile`, `/movie/[id]`, `/player/[id]`, `/subscribe`.

- [ ] **Step 3: Run the automated per-page assertions**

At each width, on each page, evaluate:

```js
({
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  navCount: document.querySelectorAll('nav[aria-label="เมนูหลัก"]')
    .length && [...document.querySelectorAll('nav[aria-label="เมนูหลัก"]')]
      .filter((n) => getComputedStyle(n).display !== 'none').length,
  upscaledImages: [...document.querySelectorAll('img')]
    .filter((i) => i.naturalWidth && i.naturalWidth < i.getBoundingClientRect().width)
    .map((i) => i.currentSrc),
  smallTargets: [...document.querySelectorAll('a,button')]
    .filter((el) => { const r = el.getBoundingClientRect();
      return r.width > 0 && (r.width < 44 || r.height < 44); }).length,
})
```

Expected: `horizontalOverflow: false` · `navCount: 1` on the six `(app)` routes and `0` elsewhere · `upscaledImages: []` · `smallTargets: 0` at 390 and 834 (the 44px floor is a touch requirement; it does not apply at 1194+ with a mouse).

`horizontalOverflow` is the check that cannot be replaced by looking at screenshots: `globals.css` sets `overflow-x: hidden` on `body`, which *hides* a too-wide child rather than preventing it, so overflow is invisible but still present.

- [ ] **Step 4: Confirm safe-area insets still resolve**

At 390 with a notched profile, confirm `pt-safe`/`pb-safe` still produce non-zero padding on `/discover` and `/player` — `viewportFit: 'cover'` (`layout.tsx:42`) is what makes `env(safe-area-inset-*)` non-zero, and nothing in this plan should have touched it.

- [ ] **Step 5: Record results and fix what the sweep found**

Write the results table to `docs/superpowers/plans/2026-08-17-responsive-verification.md`: one row per screen × width, with PASS or the specific defect. Fix each defect in the owning task's file, re-run that screen's checks, and commit fixes separately from the record.

- [ ] **Step 6: Final gate and commit**

```bash
cd apps/flick-app && npm run lint && npm test && npm run build && npm run performance:check
git add docs/superpowers/plans/2026-08-17-responsive-verification.md
git commit -m "docs: record responsive verification across all breakpoints"
```

---

## Self-review notes

**Spec coverage.** Part 1 breakpoints → Global Constraints. Part 2 primitives → Tasks 1, 4. Part 3 navigation → Tasks 2, 3. Part 4 matrix: `/home` T6 · `/discover` T12 · `/player` T11 · `/movie` T10 · `/search`+`/bookmarks` T7 · `/downloads`+`/profile` T8 · `/subscribe`+landing+auth T9 · `loading.tsx` files folded into their screens' tasks · `sizes` pass across T5, T6, T9, T10. Part 5 verification → T13. Out-of-scope items (landscape rotate prompt, commerce, theming) have no tasks, as intended.

**Known risk carried forward.** The CSS budget has 15% headroom and this plan is additive; Task 13 Step 1 names the specific remedy rather than leaving it to be discovered.

**Flagged for the reviewer.** Task 11 Step 3 deviates from `FRONTEND_PLAN.md:231` (right pillar rather than left) with reasoning and a one-line revert.
