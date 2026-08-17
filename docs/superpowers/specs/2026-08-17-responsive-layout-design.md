# Responsive layout: desktop, iPad, smartphone

> A presentation-layer design for making Flick render correctly from 390px to 1920px.
> No task in this document changes a data fetch, an entitlement check, or an API
> contract — the same boundary `docs/FRONTEND_PLAN.md` draws, and for the same reason.
>
> **Verified against:** Next.js 16.2.12 · Tailwind CSS 4.3.3 · 17 Aug 2026

---

## Prologue: what is actually there today

The app is not "mostly responsive with gaps." It is a fixed portrait column with one
responsive screen.

| Finding | Where | Consequence |
|---|---|---|
| 22 responsive utilities in the whole `src/` tree: 17 on `/home`, 3 on its loading skeleton, 2 on `/search`'s grid | `HomeClient.tsx:69-89`, `home/loading.tsx`, `SearchClient.tsx:149` | Nine other screens have none at all — they render at phone proportions on a 1440px monitor. |
| Three unrelated opinions about page width | `max-w-4xl` (hero), `max-w-5xl` (shelves), `max-w-sm` (nav, login) | No shared notion of "how wide is a page." |
| The page wrapper is copy-pasted 9× | 9 files carry `min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))]` | The bottom-nav offset must be un-set in 9 places once the nav moves. |
| `profile` and `downloads` hand-roll a copy of `AppHeader` | `profile/page.tsx:71-90`, `DownloadsClient.tsx:16-30` | Same logo, same two action buttons, already drifting (`px-5` vs `px-4`, `sticky` vs not). The desktop nav has to live in the header, and there are three headers. |
| Poster grids are hard-coded to 3 columns | `BookmarksClient.tsx:18`, `SubscribeClient.tsx:99` | 3 columns at 1440px means 400px-wide posters. |
| `next/image` `sizes` are written for phones | `MovieCard.tsx:51`, `HomeClient.tsx:161`, `MovieClient.tsx:197` | Widening a card without widening `sizes` serves an upscaled small rendition — a *visibly blurrier* desktop than today. |
| Player chrome spans the viewport, not the stage | `PlayerClient.tsx:176`, `:298` | At 1440px the title and scrub bar float in the pillarbox, detached from the 9:16 video. |
| Search's sticky offset hard-codes the header height | `SearchClient.tsx:97` — `sticky top-16` | Any change to `AppHeader`'s height silently breaks the search bar's stick point. |

**What is already right and must survive:** `[@media(hover:hover)]` guards on every
hover affordance (`MovieCard.tsx:33`, `HomeClient.tsx:158`, `MovieClient.tsx:183`) —
these are what stop an iPad-wide touch device from inheriting mouse behaviour, and they
become *more* load-bearing at 1194px, not less. Also: `pt-safe`/`pb-safe`, the snap-scroll
shelves, the `prefers-reduced-motion` floor, and the `aspect-[9/16]` stage box.

---

## Part 1 — The breakpoint contract

Tailwind v4's defaults land cleanly on the target devices. **No custom breakpoints are
added.** Values read from the installed `node_modules/tailwindcss/theme.css:327-331`,
not from memory: `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536. A bespoke `--breakpoint-ipad: 834px` would be a token that means "one device"
rather than "one layout regime," and it would drift the moment a device changes size.

| Device | Width | Prefix in effect | Layout regime |
|---|---|---|---|
| iPhone 14/15 | 390 | *(base)* | Portrait column, bottom pill nav |
| iPad portrait | 834 | `md` | Portrait column, wider gutters, denser grids, **bottom pill kept** |
| iPad landscape | 1194 | `lg` | **Top nav bar**, two-column detail, centered stages |
| Desktop | 1440 | `xl` | Container capped, largest cards |
| Large desktop | 1920 | `2xl` | Identical to `xl` — the container stops growing |

**Why iPad portrait keeps the bottom pill.** 834px is a two-handed touch device. Moving
navigation to the top edge of a 1194px-tall screen trades thumb reachability for nothing.
The switch is bound to `lg` (1024px), which puts iPad *landscape* and desktop on the bar
and iPhone plus iPad *portrait* on the pill. This is a layout-regime boundary, not a
device boundary, which is why it can be a stock breakpoint.

**Base is the phone.** Every rule is written mobile-first — an unprefixed class is the
390px value and prefixed classes only ever widen. No `max-*` variants; they invert the
cascade and make a screen's phone layout unreadable without mentally subtracting later rules.

---

## Part 2 — Primitives

Three additions carry the whole system. Everything in Part 4 is then a small,
mechanical diff.

### `--container-page`

```css
@theme {
  --container-page: 87.5rem; /* 1400px */
  --container-reading: 45rem; /* 720px — settings lists, forms */
}
```

Tailwind v4's `--container-*` namespace generates `max-w-page` / `max-w-reading`.
`max-w-4xl` (hero), `max-w-5xl` (shelves) and the bare `max-w-sm` on nav both resolve
into these two.

**Why two.** A poster wall wants 1400px. A 13-row settings list stretched to 1400px is a
worse settings list — the eye loses the row it is on. `/profile`, `/downloads`,
`/subscribe`, `/login`, `/register` are reading-width screens; `/home`, `/search`,
`/bookmarks`, `/movie` are page-width screens.

### `<PageShell>` — `src/components/ui/PageShell.tsx`

Replaces the 9 copies of the wrapper div. Owns exactly two things: the app ground, and
the bottom-nav offset that must disappear at `lg`.

```tsx
// min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16
```

### `<Container>` — `src/components/ui/Container.tsx`

`mx-auto w-full` + `max-w-page` (default) or `max-w-reading` (`width="reading"`) +
the gutter scale `px-5 md:px-8 lg:px-10`.

**One constraint:** a horizontal shelf must NOT be wrapped in `Container`. The shelf
scroller carries its own gutter as padding so cards bleed to the viewport edge and the
next card peeks — wrapping it would clip that and turn a carousel into a boxed row. For
shelves, `Container` wraps the *section heading* only; the scroller sits outside it with
matching `px-5 md:px-8 lg:px-10`. `HomeClient.tsx:117-133` already has this shape.

---

## Part 3 — Navigation

### `<HeaderNav>` — `src/components/ui/HeaderNav.tsx`

A small `'use client'` island: `usePathname()`, renders the four `NAV_ITEMS` as
icon + Thai label links with the active pill treatment `BottomNav` already uses.
Class: `hidden lg:flex`.

`NAV_ITEMS` moves from `BottomNav.tsx` to `src/components/navItems.ts` and is imported
by both. **One source of truth for what the tabs are** — adding a fifth tab must not be
a two-file change with a silent failure mode.

### `AppHeader` becomes the only header

`AppHeader` renders `<HeaderNav />` between the logo block and the actions block. Then:

- `profile/page.tsx` and `DownloadsClient.tsx` delete their duplicate headers and render
  `<AppHeader />` / `<AppHeader activeAction="downloads" />`.
- `BottomNav` gains `lg:hidden`.
- `AppHeader`'s height is lifted to a token so `SearchClient.tsx:97`'s `sticky top-16`
  stops being a magic number that silently desyncs.

`AppHeader` stays a server component; only `HeaderNav` is a client island.

### Scope

Nav applies to the six `(app)` routes only. `/movie`, `/player`, `/subscribe`, `/login`,
`/register` and `/` are outside that group and keep their own chrome (back buttons,
close buttons) at every width — they are not tab destinations and giving them a tab bar
would misrepresent where the user is.

---

## Part 4 — Per-screen matrix

| Screen | 390 (base) | 834 (`md`) | 1194 (`lg`) | 1440 (`xl`) |
|---|---|---|---|---|
| `/home` hero | Stacked, `w-48` poster | `w-60`, still stacked | Side-by-side (exists), `h-[420px]` | `h-[460px]`, `max-w-page` |
| `/home` shelves | 1.5 cards visible | ~3.5 cards | ~5 cards | ~6 cards, capped |
| `/discover` | Full-bleed `h-dvh` slide | Full-bleed | **Centered 9:16 stage** on its own blurred bleed | Same |
| `/player` | Stage fills height | Stage fills height | Chrome aligns to stage; **rail exits to pillar** | Same |
| `/movie` | Single column | Single column, wider gutter | **2-col: sticky poster/meta + episode list** | Same, `max-w-page` |
| `/search` | `grid-cols-3` | `md:grid-cols-4` (exists) | `lg:grid-cols-5` | `xl:grid-cols-6` |
| `/bookmarks` | `grid-cols-3` | `md:grid-cols-4` | `lg:grid-cols-5` | `xl:grid-cols-6` |
| `/downloads` | Full-width rows | `max-w-reading` | `max-w-reading` | `max-w-reading` |
| `/profile` | Full-width rows | `max-w-reading` | `max-w-reading` | `max-w-reading` |
| `/subscribe` | Plans stacked | **Plans `md:grid-cols-3`**; packs `md:grid-cols-6` | Same, `max-w-page` | Same |
| `/` (landing) | `text-[4rem]`, `w-48` card | `md:text-[5rem]`, `w-56` | `lg:text-[6rem]`, `w-64` | Same |
| `/login`, `/register` | `max-w-sm` centered | `md:max-w-md` | Same | Same |
| `loading.tsx` × 5 | — | Mirror their screen's grid/shelf counts at every breakpoint | | |

Skeletons that don't track their screen's column count produce a layout jump on every
load at desktop width, which is worse than no skeleton. `Skeleton.tsx:23`'s
`w-[42vw] max-w-40` shelf item needs the same treatment as `MovieCard`.

### The two geometry screens

**`/discover`** — the slide is `h-dvh w-full` with an `object-cover` video, correct on a
phone and wrong at 1194px where `object-cover` crops a 9:16 source to a landscape box,
cutting off heads. At `lg`: the video moves into a centered `aspect-[9/16] h-full` box
against the blurred poster wash the landing page already uses; snap-scroll, the
IntersectionObserver, and the pointer-drag gesture are untouched. The caption/rail block
(`DiscoverClient.tsx:334`) drops from `pb-24` to `lg:pb-8` — that 24 exists to clear the
bottom nav, which is gone at `lg` — and anchors to the stage, not the viewport.

**`/player`** — the stage is already `h-full [aspect-ratio:9/16]`, which self-centers and
needs no change. What is wrong is that Zone A (`:176`) and Zone B (`:298`) are
`inset-x-0`, so at 1440px the title and scrub bar span 1440px around a ~430px video. Both
move inside the stage box at `lg`. Zone C's rail exits to a labeled left pillar per
`docs/FRONTEND_PLAN.md:229-232`. Below `lg` all three zones stay exactly as they are.

`FRONTEND_PLAN.md:233` also specifies a landscape-phone rotate prompt
(`(orientation: landscape) and (max-height: 500px)`). **Out of scope here** — it is a new
UI state with its own copy, not a responsive rule, and it is already owned by that plan.

### The `sizes` correctness pass

Every `next/image` whose rendered width grows must have its `sizes` widened in the same
edit, or the browser picks a rendition from the old (narrow) hint and upscales it:

| File | Current | Needs |
|---|---|---|
| `MovieCard.tsx:51` | `(max-width: 480px) 160px, 200px` | Full breakpoint ladder to ~260px |
| `HomeClient.tsx:161` | `190px` | Ladder to ~320px |
| `HomeClient.tsx:77` | caps at `340px` | Extend for `xl` hero |
| `MovieClient.tsx:197` | `112px` | Ladder for the wider 2-col episode row |

This is the one part of the pass where a "purely visual" change has a measurable
regression if skipped, so it is called out rather than left implicit.

---

## Part 5 — Verification

Screenshots at every breakpoint, driving real Chrome against `npm run dev` — not
inferred from the diff.

**Widths:** 390 · 834 · 1194 · 1440, with 1920 spot-checked.

**Screens:** `/`, `/login`, `/register`, `/home`, `/discover`, `/search`, `/bookmarks`,
`/downloads`, `/profile`, `/movie/[id]`, `/player/[id]`, `/subscribe`.

**Per shot, the checks that catch what a diff review cannot:**

1. No horizontal scrollbar on `body` (the `overflow-x: hidden` in `globals.css` *hides*
   overflow rather than preventing it — a wide child is invisible, not absent).
2. Nav is present exactly once — no screen showing both the pill and the bar.
3. Posters are not upscaled (`naturalWidth` ≥ rendered width).
4. Tap targets ≥ 44px at 390 and 834.
5. Safe-area insets still resolve on the notched profile.

**Gates:** `npm run lint --workspaces`, `npm test`, `npm run build --workspaces`, and
`npm run performance:check` — the last because the repo enforces bundle budgets
(`scripts/check-performance-budgets.mjs`) and `HeaderNav` adds a client island.

---

## Risks

| Risk | Mitigation |
|---|---|
| `lg` nav switch double-renders nav during the `lg:hidden` / `hidden lg:flex` crossover | Both bound to the same 1024px breakpoint; verified explicitly at 1194 and 834. |
| Widening cards without `sizes` makes desktop blurrier than today | Part 4's `sizes` table; `naturalWidth` assertion in verification. |
| `Container` wrapped around a shelf kills the edge bleed | Stated as a constraint in Part 2; visually checked on `/home` and `/movie`. |
| Two-column `/movie` at `lg` reflows the `ViewTransition` episode morph | The morph is keyed on `episode-${id}`, not position; check the transition at 1194. |
| `AppHeader` on `profile`/`downloads` changes their action set | Both already render exactly the same two actions; `downloads` gets `activeAction="downloads"` to keep its current active state. |

## Out of scope

Landscape-phone rotate prompt (owned by `FRONTEND_PLAN.md:233`) · any data, auth, or
playback logic · the disabled commerce flows on `/subscribe` (laid out responsively,
still disabled) · dark/light theming (the app is dark-only by design) · print styles.
