# Part 7 — Art Direction / Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flick read as *itself* rather than as a well-executed generic dark
streaming app — by spending the distinctiveness budget on portrait-first form,
display typography, and one excellent flourish, not on new colours or libraries.

**Architecture:** Three layers, built in dependency order. A **foundation** layer
tokenises what is currently ad-hoc (display type steps, a shelf rhythm scale, a
shared 3D perspective). A **geometry** layer turns the landing page's one-off
poster fan into a reusable primitive and gives `MovieCard` real depth. A
**micro-interaction** layer extends the app's existing `reaction-pop` /
`reaction-ring` flourish — which already ships — to the two surfaces that
currently have no reward: the ฿249 plan selection and the play affordance.

**Tech Stack:** Next.js 16.2.12, Tailwind CSS v4.3.3 (`@theme` tokens), pure CSS
keyframes. No motion library is installed and none is added.

**Spec:** `docs/superpowers/specs/2026-08-25-ux-improvement-design.md` (Part 7)

**Baseline:** `quick-wins-episodes-endpoint` @ `5440cc2`. Verified green:
`flick-app` 58 vitest + lint + build; `flick-api` 177 jest + 23 e2e + lint.

---

## Design philosophy

The spec's finding is that the system is *correct but anonymous*. It already
rejected, on the record, the generic recommendation of a `#0F0F23` navy ground,
an `#E11D48` accent, and Inter — the last of which carries **no Thai glyphs** and
would silently break every string in a `lang="th"` app. That verdict stands and
this plan does not revisit it.

So identity is bought with **form**, and three principles govern every task here:

1. **Portrait is the format.** Flick is 9:16 short-film; every competitor is 16:9.
   The card geometry and shelf rhythm should make that unmistakable in the first
   viewport. It is the one structural thing a competitor cannot copy without
   rebuilding their catalogue.
2. **One flourish, made excellent.** `reaction-pop` + `reaction-ring` is already
   the app's single deliberate piece of character. This plan **extends** it; it
   does not add a second vocabulary.
3. **Restraint is the premium signal.** "Wow" here means depth, weight, and
   timing — not more motion. Every animation added must survive the existing
   `prefers-reduced-motion` floor without a special case.

### One spec bullet is out of date

Part 7 of the spec contains this reasoning, written before the coin removal:

> The coin economy is a second visual language… Gold should read as *earned
> currency*.

The coin system was deleted in full — schema, backend, and frontend — and
`--color-coin` was renamed `--color-gold` in that pass. There is no earned
currency left to signify. Gold is now **badges and premium markers only**: the
"คุ้มที่สุด" plan badge and the "EP.1 ฟรี" chip. Nothing in this plan should
try to build a second visual language around it, and an executor who finds
that bullet in the spec should treat this paragraph as the correction.

### What already exists (and must not be rebuilt)

Discovery for this plan found more shipped than the spec implies. Building these
from scratch would be duplicated work:

| Asset | Where | State |
|---|---|---|
| `--animate-reaction-pop` / `--animate-reaction-ring` | `globals.css:155-168` | **Shipped**, wired into `ReactionButton` |
| `--animate-cta-pulse` | `globals.css:173-178` | **Shipped**, landing CTA sonar |
| `--animate-card-peek` | `globals.css:144-149` | **Shipped**, landing hero bob |
| Poster fan (3-card, `rotateY ±24deg`) | `LandingClient.tsx:59-96` | **Shipped** but hardcoded inline, single-use |
| `perspective: 900px` | `LandingClient.tsx:59` | The app's **only** perspective, inline |
| `prefers-reduced-motion` blanket floor | `globals.css:180-198` | **Shipped**, unlayered, covers all of the above |

---

## Global Constraints

Copied verbatim from the spec's Part 7 and the two prior specs' rules of
engagement. Every task's requirements implicitly include this section.

- **NO new animation libraries.** `package.json` contains no motion library
  (verified: no `framer-motion`, `motion`, `gsap`, `@react-spring`, `lottie`,
  `auto-animate`). Everything is CSS keyframes registered as Tailwind v4
  `@theme` tokens. A task that wants a library has failed the constraint, not
  found an exception.
- **NO new colour tokens.** The palette is closed: `ink`/`ink-1`/`ink-2`,
  `hairline`, `brand`/`brand-ink`/`brand-deep`, `gold`, `fg`/`fg-dim`/`fg-mute`,
  `ok`/`warn`/`fail`. Depth comes from shadow, blur, scale, and opacity — never
  from a new hue. `--color-gold` is badges and premium markers only.
- **`bg-brand` is a FILL, never behind white text.** 6.44:1 with `text-ink`;
  white on brand is 3.09:1 and fails AA. Pair `bg-brand` with `text-ink`
  everywhere, icons included. `text-brand-ink` is the INK form (7.85:1).
- **Reduced motion removes animation, never information.** Nothing added here
  may be the sole carrier of state. The blanket floor at `globals.css:180-198`
  already collapses every `animation-*`/`transition-*`; new work must be covered
  by it rather than opting out.
- **One concern per commit.** `npm run lint && npm run build` green before every
  commit. API suites green and untouched — this is a frontend-only plan.
- **Visual check at 390 / 834 / 1440** for anything that moves or reflows.
- **Existing motion tokens are the vocabulary:** `--duration-tap: 100ms`,
  `--duration-ui: 160ms`, `--duration-surface: 240ms`, `--duration-route: 320ms`,
  `--duration-exit: 140ms`, `--ease-enter: cubic-bezier(0,0,0.2,1)`,
  `--ease-exit: cubic-bezier(0.4,0,1,1)`. Prefer these over new literals.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/app/globals.css` | All new `@theme` tokens + keyframes. Single source of motion/type/rhythm truth. | 1, 2, 4, 6 |
| `src/components/ui/Shelf.tsx` | **New.** Section heading + horizontal rail wrapper enforcing the rhythm scale. | 2 |
| `src/components/ui/PosterFan.tsx` | **New.** Extracted, reusable 3-card fan primitive. | 3 |
| `src/features/catalog/components/MovieCard.tsx` | Card depth/geometry on hover+focus. | 4 |
| `src/app/(app)/home/HomeClient.tsx` | Adopt `Shelf` for its three rails. | 2 |
| `src/app/LandingClient.tsx` | Replace inline fan with `PosterFan`. | 3 |
| `src/app/subscribe/SubscribeClient.tsx` | Plan card selection reward. | 5 |
| `src/components/ui/ReactionButton.tsx` | Extract burst timing into a shared hook. | 5 |
| `src/components/ui/useBurst.ts` | **New.** The one-shot burst state machine, shared. | 5 |

### Component checklist

Every file this pass touches, in execution order. Nothing outside this list
should appear in the final diff — a change to any other file is a scope
question to raise, not a bonus.

- [ ] `src/app/globals.css` — `--text-display-lg`, `--text-hero` (Task 1)
- [ ] `src/app/globals.css` — the four `--spacing-shelf-*` tokens (Task 2)
- [ ] `src/components/ui/Shelf.tsx` — **new** (Task 2)
- [ ] `src/app/(app)/home/HomeClient.tsx` — three rails adopt `Shelf` (Task 2)
- [ ] `src/app/globals.css` — `--perspective-depth` (Task 3)
- [ ] `src/components/ui/PosterFan.tsx` — **new** (Task 3)
- [ ] `src/app/LandingClient.tsx` — inline fan → `PosterFan`; headline → `text-hero` (Task 3)
- [ ] `src/app/globals.css` — `--card-raise` (Task 4)
- [ ] `src/features/catalog/components/MovieCard.tsx` — depth on hover **and** focus; title visible on touch (Task 4)
- [ ] `src/components/ui/useBurst.ts` — **new** (Task 5)
- [ ] `src/components/ui/useBurst.test.ts` — **new** (Task 5)
- [ ] `src/components/ui/ReactionButton.tsx` — adopt `useBurst`, no behaviour change (Task 5)
- [ ] `src/app/subscribe/SubscribeClient.tsx` — burst on ฿249 plan selection (Task 5)

**Not touched by any task:** anything under `apps/flick-api/`. This is a
frontend-only pass; its 177 unit and 23 e2e tests must run untouched and green.

---

## Task 1: Display-type steps for Anuphan

**Files:**
- Modify: `apps/flick-app/src/app/globals.css` (type scale block, ~lines 52-64)

**Interfaces:**
- Produces: `--text-hero`, `--text-display-lg` tokens (usable as `text-hero`,
  `text-display-lg`). Tasks 2 and 3 consume them.

**Context:** The spec says *"Anuphan at display sizes is genuinely distinctive;
the app currently under-uses it."* Discovery confirms the gap concretely: the
scale tops out at `--text-display: 2rem`, so every headline above that reaches
for a raw Tailwind size instead. `LandingClient.tsx:51` hardcodes
`text-[4rem] md:text-[5rem] lg:text-[6rem]`, and three `HomeClient` rail headings
use `text-2xl` (1.5rem) — a value the scale does not define at all. The scale has
no rung above 2rem, so the system silently stops governing exactly where the
typeface is most distinctive.

- [ ] **Step 1: Add the two display rungs**

In `apps/flick-app/src/app/globals.css`, find the type scale block and add after
the existing `--text-display--font-weight: 700;` line:

```css
  /* Two rungs above --text-display, added because the scale previously
     stopped at 2rem and every headline past it reached for a raw Tailwind
     size (LandingClient's text-[4rem]/[5rem]/[6rem], HomeClient's text-2xl).
     Anuphan is the app's distinctive asset and it is most distinctive large,
     so the system should govern these sizes rather than abdicate them.
     Tight leading is deliberate: Thai ascenders/descenders at display size
     read as loose at the 1.25 the body scale uses. */
  --text-display-lg: 2.75rem;
  --text-display-lg--line-height: 1.12;
  --text-display-lg--font-weight: 800;
  --text-hero: 4rem;
  --text-hero--line-height: 0.92;
  --text-hero--font-weight: 800;
```

- [ ] **Step 2: Verify the tokens resolve**

Run: `cd apps/flick-app && npm run build`
Expected: build succeeds. Then confirm the utilities exist by grepping the
generated CSS:

```bash
grep -o "text-hero\|text-display-lg" .next/static/css/*.css | sort -u
```
Expected: both names appear (Tailwind v4 emits a utility per `--text-*` token).

Note: Tailwind v4 only emits utilities that are **used**. If the grep is empty at
this step, that is expected — it becomes non-empty in Task 2 Step 3 and Task 3
Step 4, which are the first consumers. Do not chase it here.

- [ ] **Step 3: Commit**

```bash
git add apps/flick-app/src/app/globals.css
git commit -m "feat(app): add display-scale rungs for Anuphan

The type scale stopped at --text-display (2rem), so every headline above
it reached for a raw Tailwind size — LandingClient's text-[4rem]/[5rem]/
[6rem] and three HomeClient rail headings at text-2xl, a value the scale
never defined. Adds --text-display-lg and --text-hero with tighter
leading, because Thai at display size reads loose at body-scale 1.25."
```

---

## Task 2: A mathematical shelf rhythm

**Files:**
- Modify: `apps/flick-app/src/app/globals.css` (spacing tokens, near `--spacing-header`)
- Create: `apps/flick-app/src/components/ui/Shelf.tsx`
- Modify: `apps/flick-app/src/app/(app)/home/HomeClient.tsx` (three rail sections)

**Interfaces:**
- Consumes: `--text-title` (already exists; **not** `--text-display-lg` — see
  the heading-size note below).
- Produces: `<Shelf title={...} action={...}>{children}</Shelf>` and the
  `--spacing-shelf-*` tokens. Task 4's card widths sit inside it.

**Heading size — read before writing the component.** Rail headings use
`text-title` (1.375rem), **not** `text-display-lg`. The bug discovery found is
that headings bypass the existing `--text-title` token in favour of raw
`text-2xl`; the fix is to stop bypassing it, not to jump two rungs higher. A
2.75rem heading over a rail of 110px cards at 390px reads as clumsy, not
premium, and would fight the rhythm this task exists to establish. `text-title`
is also the codebase idiom — eight files already use it for headings.
`--text-display-lg` has its own home in Step 3a below.

**Context:** The current rhythm is not a rhythm — it is one value doing three
jobs. In `HomeClient.tsx` the section stack is `gap-10 sm:gap-14`, the
heading→rail gap is `gap-3`, and the card→card gap is *also* `gap-3`. Using the
same 12px for "separate a heading from its content" and "separate two sibling
cards" is what makes the page read as evenly-spaced rather than composed. The
rail padding `px-5 md:px-8 lg:px-10` is repeated verbatim at six call sites, so a
change means six edits and any missed one breaks alignment silently.

- [ ] **Step 1: Add the rhythm scale**

In `apps/flick-app/src/app/globals.css`, add after `--spacing-header: 4rem;`:

```css
  /* Shelf rhythm. Previously one value (gap-3) separated BOTH a heading from
     its rail AND two sibling cards, which is why the page reads as evenly
     spaced rather than composed. These are a 4/12/40px progression: cards
     sit closest (they are one object), the heading stands off its rail, and
     shelves clear each other by a full step. --spacing-shelf-inset is the
     rail's horizontal padding, previously repeated verbatim at six call
     sites in HomeClient. */
  --spacing-shelf-gap: 0.75rem;
  --spacing-shelf-head: 1.25rem;
  --spacing-shelf-stack: 3.5rem;
  --spacing-shelf-inset: 1.25rem;
```

- [ ] **Step 2: Create the Shelf component**

Create `apps/flick-app/src/components/ui/Shelf.tsx`:

```tsx
import type { ReactNode } from 'react';

interface ShelfProps {
  title: string;
  /** Optional trailing control — the "ทั้งหมด >" link on /home's rails. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * A titled horizontal rail. Exists so the shelf rhythm is stated once
 * rather than at six call sites: before this, HomeClient repeated
 * `px-5 md:px-8 lg:px-10` verbatim for every heading row and every rail,
 * and used the same gap-3 to separate a heading from its content as to
 * separate two cards.
 *
 * The rail keeps its own horizontal padding rather than inheriting it from
 * a parent, because the scroll container must run edge to edge — padding on
 * an ancestor would clip the first and last card's overhang instead of
 * letting them scroll past.
 */
export function Shelf({ title, action, children }: ShelfProps) {
  return (
    <section className="flex flex-col gap-(--spacing-shelf-head)">
      <div className="flex items-center justify-between px-(--spacing-shelf-inset) md:px-8 lg:px-10">
        <h2 className="font-display text-title tracking-tight text-fg">{title}</h2>
        {action}
      </div>
      <div className="scrollbar-hide flex snap-x snap-mandatory gap-(--spacing-shelf-gap) overflow-x-auto px-(--spacing-shelf-inset) pb-2 md:px-8 lg:px-10 [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Adopt Shelf in HomeClient's three rails**

In `apps/flick-app/src/app/(app)/home/HomeClient.tsx`, add the import:

```tsx
import { Shelf } from '@/components/ui/Shelf';
```

Change the outer stack's gap from `gap-10 sm:gap-14` to the token:

```tsx
<div className="mx-auto flex w-full max-w-page flex-col gap-(--spacing-shelf-stack)">
```

Then replace each of the three rail sections (`แนะนำ`, `ดูต่อ`, `รายการของฉัน`).
Each currently has this shape:

```tsx
<section className="flex flex-col gap-3">
  <div className="flex items-center justify-between px-5 md:px-8 lg:px-10">
    <h2 className="font-display text-2xl font-extrabold tracking-tight text-fg">แนะนำ</h2>
    {/* optional action link */}
  </div>
  <div className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 md:px-8 lg:px-10 pb-2 [-webkit-overflow-scrolling:touch]">
    {/* cards */}
  </div>
</section>
```

and becomes:

```tsx
<Shelf title="แนะนำ" action={/* the same action link, unchanged */}>
  {/* the same cards, unchanged */}
</Shelf>
```

Preserve each rail's existing children and action link exactly — this step moves
markup, it does not change what is rendered inside. The `ดูต่อ` rail keeps its
surrounding `{continueWatching.length > 0 && (...)}` guard.

- [ ] **Step 3a: Put `--text-display-lg` where a display size belongs**

The featured-title `h1` at `HomeClient.tsx:86` is the page's one genuine
display moment, and it currently ramps through three raw Tailwind sizes
(`text-2xl sm:text-3xl md:text-4xl` — 24/30/36px) without touching the scale.
Change:

```tsx
              <h1 className="font-display text-2xl leading-tight font-extrabold text-fg [text-wrap:balance] sm:text-3xl md:text-4xl">
```

to:

```tsx
              <h1 className="font-display text-2xl leading-tight font-extrabold text-fg [text-wrap:balance] sm:text-3xl md:text-display-lg">
```

Only the top step changes. The small and medium steps stay raw: they are below
the scale's display range, and inventing tokens for them would be the same
over-abstraction this task is correcting elsewhere. `--text-display-lg` carries
its own 1.12 leading and 800 weight at that breakpoint, which is why
`leading-tight` and `font-extrabold` are left in place for the lower steps but
are harmlessly overridden at `md:`.

- [ ] **Step 4: Verify**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green, 58 tests.

Then visually confirm at 390 / 834 / 1440 that: the three rails still scroll
horizontally; the first card aligns with the heading's left edge at every
breakpoint; and the gap between shelves is visibly larger than the gap between a
heading and its rail.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app/src/app/globals.css apps/flick-app/src/components/ui/Shelf.tsx "apps/flick-app/src/app/(app)/home/HomeClient.tsx"
git commit -m "feat(app): state the shelf rhythm once, in tokens

gap-3 previously separated both a heading from its rail and two sibling
cards — the same 12px doing two different jobs, which is what made the
page read as evenly spaced rather than composed. Adds a 4/12/40px
progression and a Shelf component so the rhythm and the six-times-
repeated px-5/md:px-8/lg:px-10 inset are stated once."
```

---

## Task 3: Extract the poster fan as a primitive

**Files:**
- Create: `apps/flick-app/src/components/ui/PosterFan.tsx`
- Modify: `apps/flick-app/src/app/LandingClient.tsx` (lines ~59-96)
- Modify: `apps/flick-app/src/app/globals.css` (perspective token)

**Interfaces:**
- Consumes: `--text-hero` (Task 1).
- Produces: `<PosterFan hero={...} left={...} right={...} />` and
  `--perspective-depth`. Nothing downstream depends on it; this is the identity
  set-piece, reusable for future surfaces (an empty state, a subscribe hero).

**Context:** The fan is the single most Flick-specific thing in the app —
three 2:3 posters angled around a 9:16 hero, which only works because the
catalogue is portrait. It currently exists as ~38 lines of inline `style={{
transform: ... }}` inside `LandingClient`, usable nowhere else. The
`perspective: 900px` on its container is the **only** perspective declaration in
the entire codebase, so the one technique that produces real depth is both
undiscoverable and unrepeatable.

`rotateY` without an ancestor `perspective` renders as a flat horizontal
squash, not depth — which is exactly the trap the extraction must not
reintroduce. The primitive owns its own perspective so a caller cannot forget it.

- [ ] **Step 1: Add the perspective token**

In `apps/flick-app/src/app/globals.css`, add to the `@theme` block near the
radius tokens:

```css
  /* The app's 3D depth constant. Was a lone inline `perspective: 900px` on
     LandingClient's fan — the only one in the codebase. A rotate without
     perspective renders as a flat squash rather than depth, so a token makes
     the value shared instead of a thing to remember.

     Note the two ways to apply it, because they are not interchangeable and
     picking the wrong one silently produces a flat result. The `perspective`
     PROPERTY governs a element's CHILDREN — that is the fan (Task 3), whose
     posters are children of the container. The `perspective()` transform
     FUNCTION governs the element's OWN transform — that is MovieCard
     (Task 4), which rotates itself. A card with the perspective property set
     on itself gets no depth at all. */
  --perspective-depth: 900px;
```

- [ ] **Step 2: Create the primitive**

Create `apps/flick-app/src/components/ui/PosterFan.tsx`:

```tsx
import Image from 'next/image';
import { Icon } from './Icon';
import type { Movie } from '@/types';

interface PosterFanProps {
  /** All three are optional: LandingClient destructures `movies` positionally
   *  (`const [hero, left, right] = movies`), so a short catalogue yields
   *  undefined rather than an error, and the fan degrades to what it has. */
  hero?: Movie;
  left?: Movie;
  right?: Movie;
  /** Rendered over the hero card's top-left — the "EP.1 ฟรี" chip. */
  badge?: string;
}

/**
 * Three posters fanned around a 9:16 hero — the app's identity set-piece.
 * It reads as Flick specifically because the geometry only works for a
 * portrait catalogue: a 16:9 competitor cannot copy it without reshooting.
 *
 * The perspective lives here, not on the caller. rotateY with no ancestor
 * perspective is a flat horizontal squash rather than depth, and this was
 * previously the only perspective in the codebase — easy to omit and hard
 * to notice omitting.
 *
 * The flanking cards are 2:3 (the catalogue's poster ratio) while the hero
 * is 9:16 (the player's ratio). That mismatch is deliberate: it stages the
 * transition from browsing to watching.
 */
export function PosterFan({ hero, left, right, badge }: PosterFanProps) {
  return (
    <div
      className="relative flex items-center justify-center [perspective:var(--perspective-depth)]"
    >
      {left?.posterUrl && (
        <div
          aria-hidden="true"
          className="absolute z-0 aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-2xl brightness-[0.45]"
          style={{ transform: 'translateX(-170px) rotateY(24deg) scale(0.82)' }}
        >
          <Image src={left.posterUrl} alt="" fill sizes="96px" className="object-cover blur-[1px]" />
        </div>
      )}
      {right?.posterUrl && (
        <div
          aria-hidden="true"
          className="absolute z-0 aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-2xl brightness-[0.45]"
          style={{ transform: 'translateX(170px) rotateY(-24deg) scale(0.82)' }}
        >
          <Image src={right.posterUrl} alt="" fill sizes="96px" className="object-cover blur-[1px]" />
        </div>
      )}
      {hero?.posterUrl && (
        <div className="animate-card-peek relative z-10 aspect-[9/16] w-48 shrink-0 overflow-hidden rounded-[28px] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] ring-1 ring-white/15 md:w-56 lg:w-64">
          <Image
            src={hero.posterUrl}
            alt={hero.title}
            fill
            priority
            sizes="(min-width: 1024px) 256px, (min-width: 768px) 224px, 192px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 backdrop-blur-xl">
              <Icon name="play" size={16} className="text-white" />
            </div>
          </div>
          {badge && (
            <span className="absolute top-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium tracking-wide text-gold backdrop-blur-sm">
              {badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

Note the two `aria-hidden="true"` additions on the flanking cards: they are
decorative duplicates of catalogue art with empty `alt`, and marking them hidden
keeps a screen reader from announcing two unnamed images beside the hero.

- [ ] **Step 3: Adopt it in LandingClient**

In `apps/flick-app/src/app/LandingClient.tsx`, add the import:

```tsx
import { PosterFan } from '@/components/ui/PosterFan';
```

Replace the whole fan block (the `<div className="relative flex items-center
justify-center" style={{ perspective: '900px' }}>` element and all three poster
children, through its closing `</div>`) with:

```tsx
<PosterFan hero={hero} left={left} right={right} badge="EP.1 ฟรี" />
```

Then remove any imports left unused by the replacement — check `Icon` and
`Image`, which the fan block was using; keep them only if the rest of the file
still references them.

- [ ] **Step 4: Move the hero headline onto the display scale**

In the same file, the headline at ~line 51 hardcodes three raw sizes. Change:

```tsx
<h1 className="bg-gradient-to-b from-white to-brand-ink bg-clip-text font-display text-[4rem] leading-[0.82] font-extrabold tracking-tight text-transparent md:text-[5rem] lg:text-[6rem]">
```

to:

```tsx
<h1 className="bg-gradient-to-b from-white to-brand-ink bg-clip-text font-display text-hero tracking-tight text-transparent md:text-[5rem] lg:text-[6rem]">
```

`--text-hero` carries the 4rem size, its 0.92 leading, and the 800 weight, so
`leading-[0.82]` and `font-extrabold` are dropped as redundant. The `md:`/`lg:`
steps stay as literals — they are one-off hero sizes, not scale rungs, and
inventing tokens used exactly once would be the same over-abstraction Task 2 is
correcting.

- [ ] **Step 5: Verify**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green.

Visually confirm the landing page at 390 / 834 / 1440: the fan renders with the
side posters visibly *angled in depth* (not merely narrowed); the hero still
bobs; the "EP.1 ฟรี" chip is present. Compare against `git stash` to confirm the
extraction is visually identical — this step is a refactor, not a redesign.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-app/src/components/ui/PosterFan.tsx apps/flick-app/src/app/LandingClient.tsx apps/flick-app/src/app/globals.css
git commit -m "refactor(app): extract the poster fan as a primitive

The fan is the most Flick-specific thing in the app — three 2:3 posters
angled around a 9:16 hero, geometry that only works for a portrait
catalogue — and it existed as ~38 lines of inline transforms usable
nowhere else. Its perspective: 900px was the only one in the codebase,
and rotateY without an ancestor perspective is a flat squash rather than
depth, so the primitive now owns it. Flanking posters get aria-hidden;
they are decorative duplicates with empty alt."
```

---

## Task 4: Card depth on hover and focus

**Files:**
- Modify: `apps/flick-app/src/features/catalog/components/MovieCard.tsx`
- Modify: `apps/flick-app/src/app/globals.css` (card lift token)

**Interfaces:**
- Consumes: `--perspective-depth` (Task 3).
- Produces: nothing downstream.

**Context:** `MovieCard` already lifts on hover
(`hover:-translate-y-1 hover:scale-105` plus a shadow swap), but three things
keep it from reading as premium. It is **flat** — a 2D scale, no rotation or
perspective, while the app's own fan proves the 3D vocabulary. Its hover
treatment is behind `[@media(hover:hover)]`, so **keyboard focus gets nothing**:
a `focus-visible` user sees the focus ring and no depth at all. And its title
overlay is `opacity-0` until hover, meaning on touch — the primary platform — the
title is never visible on a shelf.

The fix is one shared "raise" treatment bound to hover **and** focus-visible,
with a small `rotateX` for depth. Note `scale-105` on a `snap-x` rail child can
overlap its neighbour; the existing `hover:z-10` already handles stacking, so
keep it.

- [ ] **Step 1: Add the raise as one complete transform**

In `apps/flick-app/src/app/globals.css`, near the other `@theme` values:

```css
  /* MovieCard's raised state, as a complete transform list rather than
     separate translate/scale/rotate utilities. Two reasons.

     One: hover and focus-visible must not drift apart. The previous treatment
     lived only behind [@media(hover:hover)], so a keyboard user got the focus
     ring and none of the depth; a single value is hard to half-apply.

     Two: perspective() here is the transform FUNCTION, not the property. The
     `perspective` property applies to an element's CHILDREN, and the card
     rotates ITSELF — setting the property on the card produces a perfectly
     flat result. It must also come first in the list, because transform
     functions apply left to right and a perspective placed after the rotate
     has nothing left to project.

     rotateX is small on purpose: enough to read as a physical card catching
     light, not enough to distort the poster art. */
  --card-raise: perspective(var(--perspective-depth)) translateY(-4px) scale(1.05) rotateX(4deg);
```

- [ ] **Step 2: Apply depth to both hover and focus**

In `apps/flick-app/src/features/catalog/components/MovieCard.tsx`, replace the
`Link`'s `className` template with:

```tsx
      className={`focus-ring group relative block aspect-[2/3] shrink-0 overflow-hidden rounded-2xl bg-ink-1
        shadow-[0_8px_20px_-10px_rgba(0,0,0,0.7)]
        [-webkit-tap-highlight-color:transparent]
        transition-all duration-surface ease-enter
        [@media(hover:hover)]:hover:z-10 [@media(hover:hover)]:hover:[transform:var(--card-raise)] [@media(hover:hover)]:hover:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)]
        focus-visible:z-10 focus-visible:[transform:var(--card-raise)] focus-visible:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)]
        active:scale-95
        ${sizeClasses[size]}`}
```

Three notes on what changed and what deliberately did not:

- `hover:-translate-y-1` and `hover:scale-105` are **removed**, not kept
  alongside the new transform. Both set the same `transform` property that
  `[transform:var(--card-raise)]` sets, so keeping them would leave two
  utilities whose only effect depends on Tailwind's emission order.
- No `transform-style: preserve-3d` and no `perspective` **property** — see
  the token comment above. The card has no 3D children to preserve, and
  `overflow-hidden` on this element would force flattening anyway.
- `active:scale-95` stays as-is. It also writes `transform`, so on a mouse
  device a pressed card resolves to whichever of hover/active Tailwind emits
  later — but that was equally true of the `-translate-y-1 scale-105` it
  replaces, so this is not a regression. On touch, where the press feedback
  actually matters, `[@media(hover:hover)]` blocks the hover rule and
  `active:scale-95` applies unopposed.

The `focus-visible:` variants are deliberately **not** inside
`[@media(hover:hover)]` — a keyboard user on a touch-capable device should still
get the depth.

- [ ] **Step 3: Make the title readable without hover**

In the same file, the title overlay is `opacity-0` until
`[@media(hover:hover)]:group-hover:opacity-100`. On touch that is never. Change
the overlay `div`'s className to:

```tsx
        className="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/90 to-transparent
          px-2 pt-4 pb-2 transition-opacity duration-surface
          opacity-100 [@media(hover:hover)]:opacity-0
          [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:opacity-100"
```

This reads: visible by default (touch, where there is no hover to reveal it),
hidden on genuine hover devices until hover or keyboard focus. Information is
gained on touch, not lost anywhere.

- [ ] **Step 4: Verify**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green. `MovieCard.test.tsx` asserts the `sizes` hint, which this
step does not touch — it must still pass unmodified.

Then verify by hand:
1. Mouse-hover a card on `/home` — it lifts, tilts slightly, and shadows.
2. **Tab** to a card — it gets the same lift and tilt, plus the focus ring.
3. At 390px, card titles are visible **without** interaction.
4. With OS "reduce motion" on, hover produces the end state with no animation
   and the card is still fully usable.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app/src/features/catalog/components/MovieCard.tsx apps/flick-app/src/app/globals.css
git commit -m "feat(app): give cards depth on focus, not just hover

The lift lived entirely behind [@media(hover:hover)], so a keyboard user
got the focus ring and none of the depth. Binds the same raise to
focus-visible and adds a small rotateX against the shared perspective —
the 3D vocabulary the poster fan already established. Card titles now
show by default on touch, where there is no hover to reveal them."
```

---

## Task 5: Extend the flourish to plan selection

**Files:**
- Create: `apps/flick-app/src/components/ui/useBurst.ts`
- Modify: `apps/flick-app/src/components/ui/ReactionButton.tsx`
- Modify: `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`

**Interfaces:**
- Consumes: `--animate-reaction-pop`, `--animate-reaction-ring` (both already in
  `globals.css:155-168`).
- Produces: `useBurst(active: boolean): boolean`.

**Context:** This is the task most at risk of duplicated work. `reaction-pop` and
`reaction-ring` **already exist and already ship** — `globals.css:155-168`,
wired into `ReactionButton.tsx:70,76`. They are not to be rebuilt. The spec's
instruction is *"One flourish, already chosen. Do not add a second; make that one
excellent."*

Making it excellent means **extending its reach**. Today the app's single moment
of delight fires only on like/bookmark. The highest-intent action in the product
— choosing the ฿249 plan — has no reward at all: `SubscribeClient`'s card renders
a `Button` with a `loading` state and nothing else. The burst belongs there.

`ReactionButton` currently owns the one-shot burst state machine inline (a
`useState` + `useRef` + `setTimeout` in a `useEffect`). Extracting it is what lets
a second surface use it without copying timing logic that must stay in sync with
the 550ms keyframe.

- [ ] **Step 1: Write the failing test**

Create `apps/flick-app/src/components/ui/useBurst.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBurst } from './useBurst';

describe('useBurst', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not fire on the initial render, even when already active', () => {
    const { result } = renderHook(() => useBurst(true));
    expect(result.current).toBe(false);
  });

  it('fires on the transition into active', () => {
    const { result, rerender } = renderHook(({ a }) => useBurst(a), {
      initialProps: { a: false },
    });
    rerender({ a: true });
    expect(result.current).toBe(true);
  });

  it('clears itself after the animation window', () => {
    const { result, rerender } = renderHook(({ a }) => useBurst(a), {
      initialProps: { a: false },
    });
    rerender({ a: true });
    expect(result.current).toBe(true);

    act(() => void vi.advanceTimersByTime(600));
    expect(result.current).toBe(false);
  });

  it('does not fire on the transition OUT of active', () => {
    const { result, rerender } = renderHook(({ a }) => useBurst(a), {
      initialProps: { a: true },
    });
    rerender({ a: false });
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd apps/flick-app && npm test -- useBurst`
Expected: FAIL — cannot resolve `./useBurst`.

- [ ] **Step 3: Write the hook**

Create `apps/flick-app/src/components/ui/useBurst.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';

/** Matches --animate-reaction-ring's 550ms in globals.css. Kept in one place
 *  so a second consumer cannot drift out of sync with the keyframe. */
const BURST_MS = 550;

/**
 * One-shot burst state for the app's single flourish (reaction-pop +
 * reaction-ring). True for the length of the animation on the transition
 * INTO `active`, then false again.
 *
 * Deliberately silent on the initial render and on the transition out: a
 * page that loads with something already liked should not celebrate, and
 * un-liking is not an achievement.
 */
export function useBurst(active: boolean): boolean {
  const [burst, setBurst] = useState(false);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      setBurst(true);
      const timer = window.setTimeout(() => setBurst(false), BURST_MS);
      wasActive.current = active;
      return () => window.clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active]);

  return burst;
}
```

- [ ] **Step 4: Run it to watch it pass**

Run: `cd apps/flick-app && npm test -- useBurst`
Expected: PASS — 4 tests.

- [ ] **Step 5: Adopt the hook in ReactionButton**

In `apps/flick-app/src/components/ui/ReactionButton.tsx`, replace the imports:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from './Icon';
```

with:

```tsx
import { Icon, IconName } from './Icon';
import { useBurst } from './useBurst';
```

Then delete the inline state machine:

```tsx
  const [burst, setBurst] = useState(false);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      setBurst(true);
      const timer = window.setTimeout(() => setBurst(false), 550);
      wasActive.current = active;
      return () => window.clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active]);
```

and replace it with:

```tsx
  const burst = useBurst(active);
```

The rest of the component — including both `animate-reaction-ring` and
`animate-reaction-pop` usages — is unchanged. This is a pure extraction; the
button must look and behave identically.

- [ ] **Step 6: Add the burst to plan selection**

In `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`, add the import:

```tsx
import { useBurst } from '@/components/ui/useBurst';
```

Inside `SubscribeForm`, add alongside the existing state:

```tsx
  // The highest-intent action in the product had no reward at all. Reuses the
  // app's one flourish rather than introducing a second vocabulary.
  const [chosen, setChosen] = useState<string | null>(null);
  const burst = useBurst(chosen !== null);
```

In `handleBuy`, record the choice as the first statement:

```tsx
  const handleBuy = async (itemId: string) => {
    setChosen(itemId);
    setBusyItem(itemId);
```

and clear it again in the failure branch that already exists a few lines below,
so the next attempt is a fresh false→true transition:

```tsx
    if (!result.success) {
      // Without this, `chosen` stays set and useBurst never sees another
      // transition — a successful checkout navigates away, but a failed one
      // leaves the user here, and every retry would animate nothing.
      setChosen(null);
      setBusyItem(null);
      setError(result.error);
      return;
    }
```

Then, on the paid plan's card `div` — the one with the
`relative rounded-3xl border p-6 ...` className — add the ring as a sibling
**inside** that div, immediately before the `{plan.badge && (...)}` block:

```tsx
                  {burst && chosen === plan.id && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 animate-reaction-ring rounded-3xl border-2 border-brand-ink"
                    />
                  )}
```

The ring uses `rounded-3xl` to match the card's own radius rather than
`rounded-full` — the keyframe scales and fades, and neither is shape-dependent.
`aria-hidden` and `pointer-events-none` keep it decorative: the checkout still
proceeds on the click, and nothing about the payment depends on the animation
running.

- [ ] **Step 7: Verify**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green, 62 tests (58 + 4 new).

Then verify by hand on `/subscribe`:
1. Click "สมัครแพ็กเกจนี้" — a ring radiates from the ฿249 card as the button
   enters its loading state.
2. The checkout still navigates to the gateway (the burst must not have
   swallowed the click).
3. With OS "reduce motion" on, the click still checks out and the ring is
   effectively instant — no stall, no missing information.
4. `/player/<id>` and `/movie/<id>`: like and bookmark still burst exactly as
   before the extraction.

- [ ] **Step 8: Commit**

```bash
git add apps/flick-app/src/components/ui/useBurst.ts apps/flick-app/src/components/ui/useBurst.test.ts apps/flick-app/src/components/ui/ReactionButton.tsx apps/flick-app/src/app/subscribe/SubscribeClient.tsx
git commit -m "feat(app): extend the flourish to plan selection

reaction-pop and reaction-ring already shipped, wired only into
ReactionButton — so the app's single moment of delight fired on
like/bookmark and never on choosing the 249 plan, the highest-intent
action in the product. Extracts the one-shot burst state machine into
useBurst so a second surface can use it without copying timing that
must stay in sync with the 550ms keyframe, then fires it on plan
selection. No second animation vocabulary; the ring is decorative and
the checkout does not depend on it."
```

---

## Task 6: Whole-pass verification

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: Tasks 1-5.

**Context:** Part 7 is the one pass in the whole programme that is judged by eye
rather than by assertion. The suites confirm nothing regressed; they cannot
confirm the app looks premium. Both checks belong here.

- [ ] **Step 1: Full suites**

```bash
cd apps/flick-app && npm test && npm run lint && npm run build
cd ../flick-api && npm test && npm run lint
```

Expected: `flick-app` 62 tests green, lint clean, build clean. `flick-api`
**177 tests, untouched** — this is a frontend-only plan; any API change is a
scope error to investigate, not to accept.

- [ ] **Step 2: Constraint audit**

Run each and confirm the expected result:

```bash
cd apps/flick-app
# No motion library was added.
grep -iE '"(framer-motion|motion|gsap|@react-spring|lottie|auto-animate)"' package.json || echo "PASS: no motion library"
# No new colour token was added. Expect exactly the documented set.
grep -c "^  --color-" src/app/globals.css
```
Expected: the first prints `PASS`. The second must print **14** — the count at
`5440cc2`, measured while writing this plan. Any higher number means a colour
token was added, which is a violated constraint, not a judgement call.

- [ ] **Step 3: Reduced-motion pass**

With OS "reduce motion" enabled, confirm every surface this plan touched remains
fully usable and loses no information: `/` (fan + hero), `/home` (shelves +
cards), `/subscribe` (plan burst), `/movie/<id>` and `/player/<id>` (reaction
buttons). Nothing may be `display:none` under reduced motion, and no state may be
conveyed by animation alone.

- [ ] **Step 4: Responsive pass**

At 390 / 834 / 1440, on `/`, `/home`, `/discover`, `/subscribe`, `/movie/<id>`:
confirm no horizontal overflow (`document.documentElement.scrollWidth ===
clientWidth`), shelf insets align with headings, and the fan is not clipped.

- [ ] **Step 5: Commit the verification record**

```bash
git commit --allow-empty -m "docs: record verification of the Part 7 art-direction pass

flick-app 62 tests + lint + build green; flick-api 177 untouched.
Constraint audit: no motion library added, colour-token count
unchanged. Reduced-motion and 390/834/1440 responsive passes clean
across the landing fan, home shelves, cards, and plan selection."
```

---

## Sequencing and rationale

| Task | Depends on | Why here |
|---|---|---|
| 1 — display type | — | Pure token addition; Tasks 2 and 3 consume the rungs. |
| 2 — shelf rhythm | 1 | Step 3a spends `--text-display-lg` on HomeClient's featured h1. Establishes the grid everything else sits in. |
| 3 — poster fan | 1 | Uses `--text-hero`; publishes `--perspective-depth`, which Task 4 needs. |
| 4 — card depth | 2, 3 | Needs the perspective token and the rail it lives in. |
| 5 — flourish | — | Independent of 1-4; could run in parallel if desired. |
| 6 — verification | all | Judged by eye; runs last. |

---

## Not in this plan

- **New colour tokens or a palette change.** Closed by the spec's rejection of
  the `#0F0F23` / `#E11D48` recommendation, and by the Global Constraints.
- **A second animation vocabulary.** The spec's "do not add a second" is why
  Task 5 extends `reaction-*` rather than authoring a new keyframe set.
- **Typeface changes.** Anuphan + IBM Plex Sans Thai stay. Inter carries no Thai
  glyphs and is rejected on the record.
- **Offline playback (spec Part 5b).** Its own spec, blocked on the
  content-protection decision.
- **View-transition choreography between routes.** `MovieCard` documents a real
  constraint — the same movie can render twice on one page, and React's
  `ViewTransition` requires unique names among mounted instances. Revisiting that
  is its own piece of work, not art direction.
