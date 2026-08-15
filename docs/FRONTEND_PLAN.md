# Cinnabar: Flick.com Design System & Frontend Migration Blueprint

> A Tailwind v4 design system and phased migration plan for Flick's portrait-first Thai
> short-film streaming app. This is a **presentation-layer migration only** — no task in
> this document changes a data fetch, an entitlement check, or an API contract. The data
> layer (`apiFetch`, cancellation guards, server-side session checks, HLS playback) is
> correct today and stays untouched.

**Verified against:** Next.js 16.2.12 (installed docs in `node_modules/next/dist/docs/`) · 16 Aug 2026

---

## Prologue: Audit findings

| Finding | Where | Consequence | Severity |
|---|---|---|---|
| Inter carries no Thai glyphs, yet it's the only face loaded | `app/globals.css:1` | Every Thai string falls back to the OS font (Thonburi on iOS, Noto Sans Thai on Android). Typography is currently unowned. | Critical |
| Font loaded via `@import url(fonts.googleapis.com)` | `app/globals.css:1` | Render-blocking third-party request on every page; `next/font` exists to remove this. | Critical |
| No `error.tsx`, `loading.tsx`, or `not-found.tsx` anywhere | `src/app/**` | No Suspense fallbacks, no error boundaries. Loading states are `return null` — a blank screen. | Critical |
| `viewport-fit=cover` missing from viewport meta | `app/layout.tsx:14` | `env(safe-area-inset-*)` resolves to `0` everywhere. Notch/home-indicator handling can't work until this is set. | Critical |
| `BottomNav` mounted per-page, not in a layout | 7 × `page.tsx` | Unmounts/remounts on every navigation. Blocks shared-layout transitions structurally. | Blocker |
| Player fetches the entire catalogue, then finds the episode with a nested loop | `PlayerClient.tsx:66-78` | `GET /movies` → `findEpisode()` over every season of every movie. Time-to-first-frame scales with catalogue size. | High |
| Player controls never auto-hide; UI is emoji glyphs | `PlayerClient.tsx` | `▶ ⏸ ⚙️ ♥ ☆ ⇩ ⛶ ←` render differently per platform. Permanent chrome costs picture area. | High |
| Commerce is a dead end | `SubscribeClient.tsx` | `coins_required` gate routes to `/subscribe`, where every plan button and coin pack is disabled. | High |
| `next/image` used with no `remotePatterns` configured | `MovieCard.tsx` / `next.config.mjs` | Remote posters can't be optimized; `HomeClient` falls back to raw `<img>` with an eslint-disable. | High |
| Player toast has no dismissal path | `PlayerClient.tsx` | `notice` only clears on the next action — can sit on screen for the rest of the episode. | Medium |
| 13 inert rows on the profile screen | `profile/page.tsx` | Settings/support lists render `settingItemDisabled` with a chevron — a promise of navigation that isn't kept. | Medium |
| Search filters the whole catalogue client-side, undebounced, via raw `fetch` | `search/page.tsx:17-21` | Bypasses `apiFetch`; empty query renders the full catalogue as if it were a result set. | Medium |

**What to preserve:** `apiFetch` centralizes credentials and error shape; every screen uses
cancellation guards; `PlayerClient` re-asks the server for authorization after a coin spend
rather than granting optimistically; `page.tsx` files isolate failure domains. None of that
is design work and none of it should be touched.

---

## Part 1 — Design system & Tailwind architecture

**Direction: cinnabar on warm ink.** Keep `--flick-red` exactly as it is; fix what's around it.

### Why the palette reads muddy today

`--flick-red: #CC3300` is a warm vermilion. The problem is its neighbors: `--bg-surface:
#1A1A2E` and `--bg-surface-hover: #252540` are blue-violet navies — an accidental
near-complement that makes the red read dirty. **Fix: rotate the surfaces warm and leave
the brand hue untouched.**

### Core palette

| Token | Hex | Role |
|---|---|---|
| Ink | `#0B0908` | App ground. Warm near-black, replacing pure `#000`. |
| Ink 1 | `#171310` | Cards, sheets, nav bar. Replaces `#1A1A2E`. |
| Ink 2 | `#241D18` | Raised/hover/skeleton base. Replaces `#252540`. |
| Cinnabar | `#CC3300` | **Fill only.** Primary buttons, active nav, scrub fill, like-state. |
| Ember | `#FF4D1A` | **Ink only.** Accessible text/icon form of the brand on dark. Already `--flick-red-light`. |
| Gold | `#E8B84B` | Coin economy only — balances, costs, unlock affordances. |

### Measured contrast (WCAG, against existing `#000` ground)

| Pair | Ratio | Result |
|---|---|---|
| `#CC3300` text on `#0B0908` | 4.04:1 | **Fails AA** |
| White on `#CC3300` fill | 5.20:1 | Passes AA |
| `#FF4D1A` text on `#0B0908` | 6.33:1 | Passes AA |
| `--text-muted` (`#666680`) on black | 3.78:1 | **Fails AA** for body text — legal for large/disabled only |
| `--text-secondary` (`#A0A0B0`) on black | 8.15:1 | Passes AAA |
| Gold `#E8B84B` on ink | 11.4:1 | Safe as an ink |

**System rule:** cinnabar is a surface, not an ink. `bg-brand` and `text-brand` resolve to
*different hex values* so a developer can't get it wrong by reaching for the obvious class.

### Typography: the Thai problem is the whole problem

The app declares `lang="th"`, every string is Thai, and the only loaded font (Inter) has no
Thai coverage. This is the highest-leverage change in the plan.

**What Thai script needs:**
- **Vertical room** — stacked vowel/tone marks collide at `line-height: 1.6`. Body wants **1.75–1.8**.
- **Looped vs. loopless** — loopless (มีหัว-less) reads modern for display; looped survives small sizes without losing distinguishing loops.
- **Matched Latin** — Thai UI mixes in VIP, 1080p, ฿149 constantly; use a family co-designed for both scripts.
- **No letter-spacing** — tracking breaks Thai mark positioning. Restrict `tracking-*` to mono labels only.

**Recommended pairing:**

| Role | Face | Notes |
|---|---|---|
| Display (หัวเรื่อง) | **Anuphan** | Loopless, variable, Thai+Latin. Deliberately not Kanit/Prompt (already ubiquitous in Thai product design). Used ≥20px only. |
| Body & UI (เนื้อความ) | **IBM Plex Sans Thai** | Looped, Latin co-designed. Default `font-sans`. |
| Data (ตัวเลข) | **IBM Plex Mono** | Tabular figures for timecodes, coin balances, episode numbers — not decoration, prevents UI jitter. |

Alternative: **LINE Seed Sans TH** for display if brand familiarity matters more than novelty
— free, loads via `next/font/local` since it isn't on Google Fonts. Swappable in Phase 0 at
no cost downstream.

**Type scale:**

| Token | Size | Line-height | Face/weight | Used for |
|---|---|---|---|---|
| `text-display` | 32px | 1.25 | Anuphan 700 | Movie detail title, subscribe headline |
| `text-title` | 22px | 1.35 | Anuphan 600 | Section headers, sheet titles |
| `text-lg` | 18px | 1.55 | Plex Thai 600 | Card titles, plan names |
| `text-base` | 16px | **1.78** | Plex Thai 400 | Descriptions, body copy |
| `text-sm` | 14px | 1.7 | Plex Thai 400 | Metadata, secondary rows |
| `text-xs` | 12px | 1.6 | Plex Thai 500 | Nav labels, chips, badges |
| `text-data` | 14px | 1.2 | Plex Mono 500 | Timecode, coins, episode numbers |

### Spacing & radius (unchanged, just tokenized)

| Today | Tailwind v4 token | Applies to |
|---|---|---|
| `--radius-sm: 8px` | `--radius-sm` | Chips, small buttons |
| `--radius-md: 12px` | `--radius-md` | Cards, inputs, poster tiles |
| `--radius-lg: 16px` | `--radius-lg` | Sheets, modals |
| `--radius-xl: 24px` | `--radius-xl` | Primary CTA pills |
| `--nav-height: 64px` | `--spacing-nav` | Top chrome offset |
| `--bottom-nav-height: 72px` | `--spacing-navbar` | Bottom chrome offset + safe-area |

Don't tokenize one-off gradients or single-use values — a token with one consumer is
indirection, not a system.

### Tailwind v4 architecture

Next 16.2.12's own CSS guide installs Tailwind v4 (`tailwindcss` + `@tailwindcss/postcss`) —
CSS-first, no `tailwind.config.js`, theme defined via `@theme`. Because the app's tokens are
already CSS custom properties, moving them into `@theme` converts documentation into utility
classes automatically, and **existing CSS Modules keep working unchanged** — this is what
makes an incremental, screen-by-screen migration possible.

```css
/* postcss.config.mjs */
export default { plugins: { '@tailwindcss/postcss': {} } };
```

```css
/* globals.css structure */
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-plex-thai);
  --font-display: var(--font-anuphan);
  --font-mono: var(--font-plex-mono);
}

@theme {
  --color-ink: #0B0908;
  --color-ink-1: #171310;
  --color-ink-2: #241D18;
  --color-brand: #CC3300;      /* fill */
  --color-brand-ink: #FF4D1A;  /* text/icon */
  --color-coin: #E8B84B;
  --color-fg: #FFFFFF;
  --color-fg-dim: #A9A099;     /* 8.15:1 — safe for copy */
  --color-fg-mute: #7A716B;    /* large text / disabled only */
  --text-base--line-height: 1.78;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
}

@utility pb-safe { padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
@utility pt-safe { padding-top: max(1rem, env(safe-area-inset-top)); }
```

**Browser floor check:** Tailwind v4 requires Safari 16.4+, Chrome 111+, Firefox 128+ (uses
`@property`/`color-mix()`, no polyfill). Pull the Android/Chrome version breakdown from
analytics before committing; if below-threshold share is material, use the documented v3
path instead — the same tokens express via `tailwind.config.js`.

**Coexistence contract:** Tailwind and CSS Modules run side by side for the whole migration.
A file is either fully migrated or fully untouched — never half. Delete each `.module.css`
in the same commit that migrates its component.

---

## Part 2 — Portrait-first player UX

### The geometry problem

A 9:16 video in a 9:19.5 viewport leaves ~160px of letterbox. The current rail position is
computed from viewport units (`calc((100vw - (100dvh * 9/16))/2 + 1rem)`), which
desynchronizes if the video isn't exactly 9:16 or `dvh` shifts mid-scroll. Fix: give the
stage `aspect-[9/16]` and position the rail relative to that container, not the viewport.

### Three-zone model

```
┌─────────────────────────────────┐  ← pt-safe (notch)
│  ‹        ชื่อเรื่อง          ⤢  │  Zone A · chrome (auto-hides)
├─────────────────────────────────┤
│                            ♡    │  Zone C · rail
│         S T A G E          312  │    anchored to the stage,
│      aspect-[9/16]          ☆   │    persists while playing
│                            ⤓    │
├─────────────────────────────────┤
│ ▶ ━━━━━━━━●───────── 04:17  ⚙  │  Zone B · transport (auto-hides)
└─────────────────────────────────┘  ← pb-safe (home indicator)
```

- **Zones A + B auto-hide** after 2500ms of idle playback (200ms fade-out/ease-exit,
  140ms fade-in/ease-enter on tap-to-recall).
- **Zone C persists while playing** — like/bookmark/download are expressive, not
  navigational; hiding them mid-scene costs engagement. This asymmetry is the key call.
- **The stage never moves** — overlays only, never flow, so chrome toggling causes zero
  layout shift.
- Locked visible when paused, scrubbing, or a sheet is open.
- Implement as one `useReducer` with an explicit state union — not five more booleans on
  top of the six already in `PlayerClient`.

### Touch targets

- Every control ≥ 44×44px hit area (visual circle can stay 40px; expand with padding).
- Native `<input type="range">` scrub bar, kept — add 16px transparent vertical padding
  so it's actually grabbable (currently ~4px tall).
- Rail on the right edge for right-thumb reach; mirror via preference if analytics show
  material left-hand use.

### Kill the emoji

Replace `▶ ⏸ ⚙️ ♥ ☆ ⇩ ⛶ ←` with a local 20-icon inline SVG set, 1.5px stroke on a 24px grid,
matching `BottomNav`'s existing (correct) icon weight. No icon library dependency.

### Pillarbox: ambient bleed

Replace the fixed `radial-gradient(#171717, #000)` with a static ambient wash sampled from
the poster (4×4 canvas downscale, low saturation, ~12% luminance cap). Static, not animated
— an animated glow behind a drama scene is a distraction.

### Wider viewports

- Tablet/desktop: cap stage at `min(100%, calc(100dvh * 9/16))` centered (current approach,
  kept); move Zone C into a labeled left-pillar rail outside the stage.
- Landscape phone: detect `(orientation: landscape) and (max-height: 500px)` and show a
  rotate prompt rather than a 200px-wide video.

### Two prerequisite fixes

1. **Safe area is currently dead** — `layout.tsx` has no `viewport-fit=cover`, so
   `env(safe-area-inset-*)` returns 0 everywhere. Move to Next's `viewport` export with
   `viewportFit: 'cover'`.
2. **The player over-fetches** (`GET /movies` + client-side walk) — flagged as a backend
   ask (see Appendix); raised here because it caps how fast the player can ever feel.

---

## Part 3 — Closing the known gaps

### Loading states

Replace `return null` (used in `BookmarksClient`) with `loading.tsx` per route segment. A
skeleton is a wireframe of the real layout — same grid, same card aspect ratio, same row
count — never a generic gray box.

| Route | Skeleton | Count |
|---|---|---|
| `/home` | 3 section headers + 3 horizontal poster rows | 6/4/4 |
| `/discover` | Real genre chip row + poster grid | 7 chips, 9 tiles |
| `/bookmarks` | Poster grid only | 6 tiles |
| `/movie/[id]` | Hero + meta lines + episode rows | 8 rows |
| `/player/[id]` | Poster at 40% opacity + centered spinner — never a gray box | — |
| `/subscribe` | 3 plan cards at real height | 3 |

Use `animate-pulse`, not a sweeping shimmer — a shimmer across a grid draws the eye to the
loading itself.

### Empty states — five real ones, each with an exit

| Where | Proposed copy | Action |
|---|---|---|
| Bookmarks | "ยังไม่มีเรื่องที่บันทึกไว้ — แตะรูปบุ๊กมาร์กบนเรื่องที่สนใจ แล้วจะมาอยู่ที่นี่" | ไปดูเรื่องแนะนำ → `/discover` |
| Continue watching | "ยังไม่มีเรื่องที่ดูค้างไว้ — เริ่มดูสักตอน แล้วกลับมาดูต่อได้จากตรงนี้" | Row collapses, no reserved height |
| Downloads | "ยังไม่มีตอนที่ดาวน์โหลด — ดาวน์โหลดไว้ดูตอนไม่มีเน็ตได้" | ไปเลือกเรื่อง → `/discover` |
| Search, no query | Recent searches + genre shortcuts | Tap a genre chip |
| Search, no match | "ไม่พบ \"X\" — ลองค้นด้วยชื่อเรื่องหรือหมวดหมู่" | 3 genre chip fallbacks |
| Genre filter, empty | "ยังไม่มีเรื่องในหมวดดราม่า" (name the genre) | ดูทั้งหมด (resets filter) |

Visual: one 32px outline icon (`--color-fg-mute`), 16px title, 14px guidance line, text
button. No bespoke illustrations — the copy does the job.

### Errors — recover, don't apologize

| Class | Presentation | Recovery |
|---|---|---|
| 401 session expired | Silent | Redirect to `/login?next=` (add the query param) |
| Network/5xx | Inline panel, replaces failed region only | `router.refresh()`, never a full reload |
| 404 episode/movie | Full-screen via `not-found.tsx` | ไม่พบตอนนี้ + กลับหน้าหลัก |
| Playback fault | Overlaid on stage, poster visible behind | เล่นวิดีโอไม่ได้ + ลองใหม่ — retries HLS attach, never reloads the page |
| Entitlement gate | Sheet, not an error | See commerce below |
| Unexpected | `app/error.tsx` (currently missing) | ลองใหม่ via `reset()` |

### The commerce dead end

The coin gate offers "ดูแพ็กเกจสมาชิก," which lands on `/subscribe` where every paid button
is disabled. `POST /wallet/spend` works — a user *with* coins can unlock — but there's no
path to acquire coins. Keep the honesty, remove the dead end.

**Redesign the gate as a bottom sheet, branched on balance** (using `gate.coinCost` and
`GET /wallet`, both already available):

| Branch | Treatment |
|---|---|
| Balance ≥ cost | Primary: "ใช้ 10 เหรียญ" with visible arithmetic (◆320 → 310) |
| Balance < cost | "เหรียญไม่พอ · มี 3 จาก 10" + ดูตอนฟรี (eps 1-10) + แจ้งเตือนเมื่อเติมเหรียญได้ |
| Subscription required | Plan comparison inline in the sheet (from `GET /plans`) — never navigate away from the episode |

Build the full checkout flow (pack selection → confirm → pending → success → receipt)
behind a `PAYMENTS_ENABLED` flag defaulting to off. When a gateway lands, commerce becomes
a config change. Paid cards on `/subscribe` render as previews with a "เร็ว ๆ นี้" chip.

### Smaller gaps

- **Toasts:** lift to a provider with 4s auto-dismiss + queue (currently only cleared by
  the next action).
- **Profile's 13 inert rows:** keep only ภาษา, การเล่นวิดีโอ, อุปกรณ์ที่เข้าสู่ระบบ — all
  backed by real schema (`User.language`, `User.theme`, `Device`). Cut the other ten.
- **Search:** route through `apiFetch`, debounce 250ms, show recent queries on empty field.
- **Coin balance visibility:** already on `AuthenticatedUser.coinBalance`, only shown on
  `/profile` today. Surface it in the app header.

---

## Part 4 — Animation strategy

Budget rule: motion that explains where something came from, yes; motion that decorates, no.

**Prerequisite:** `BottomNav` must move into a shared layout before any transition work —
it currently remounts on every navigation, which will flicker through any cross-route effect.

### Tier 1 — CSS only (~80% of all motion, 0 KB)

Covers hover, press, chip toggle, skeleton pulse, sheet slide, toast entry.
- Press feedback: `active:scale-95` at 100ms on every button.
- Bottom sheets: translate + backdrop fade (drag-to-dismiss needs Tier 3).
- Nav tab switch: icon fill crossfade + label weight step — no sliding indicator (implies
  a spatial relationship between tabs that doesn't exist).

### Tier 2 — React `<ViewTransition>` for route changes

Next 16.2.12 ships this: `experimental.viewTransition: true`, import `ViewTransition` from
`react`. Route navigations are transitions automatically.

```tsx
<ViewTransition name={`poster-${movie.id}`} share="morph">
  <Image ... />
</ViewTransition>
```

Apply to: poster tile → movie detail hero, and episode thumbnail → player stage (the
highest-value transition in the app — makes tapping an episode feel like entering it).
Note: Safari behaves differently per the Next docs — test on real hardware.

### Tier 3 — Motion (formerly Framer Motion), used narrowly

Only for gesture/physics CSS can't do: drag-to-dismiss on sheets (velocity-based commit),
scrub-bar drag with spring-settled thumb, and a single spring "like burst" — one flourish,
one place.

**Bundle discipline:** import via `LazyMotion` + `domAnimation` + the `m` component, not
the full `motion` namespace (~5KB vs. ~34KB). This is a video app — every KB of JS competes
with the first stream segment.

### Motion tokens

| Token | Duration | Easing | Meaning |
|---|---|---|---|
| `duration-tap` | 100ms | linear | Press acknowledgement |
| `duration-ui` | 160ms | ease-enter | Toggles, chips, fades |
| `duration-surface` | 240ms | ease-enter | Sheets, toasts, overlays |
| `duration-route` | 320ms | ease-enter | View transitions |
| `duration-exit` | 140ms | ease-exit | Anything leaving — always faster out than in |

Nothing exceeds 320ms (current `--transition-slow: 400ms` is past the responsive threshold).

### Reduced motion (hard requirement)

Under `prefers-reduced-motion: reduce`: transforms become opacity-only, view transitions
disabled at config level, like burst becomes an instant fill, skeleton pulses hold static.
Reduced motion removes animation, never information.

### What not to build

No page-load stagger on lists. No parallax on the movie detail hero. No animated ambient
glow behind the player. No spinner where a skeleton fits.

---

## Part 5 — Component migration plan

Ordered by dependency — phase *n* cannot start before *n−1* lands.

**Rules of engagement:**
- No task changes a data fetch, entitlement check, or type in `src/types` — that's a
  backend ask, logged in the Appendix, not done here.
- One component per commit; delete its `.module.css` in the same commit.
- `npm run lint && npm run build` green before every commit; API Jest suites stay green
  and untouched.
- Visual diff at 390×844 before/after each screen — success is "nothing changed" until
  Phase 5 deliberately changes things.

### Phase 0 — Foundation (~2 days)

No component touched.
- Install `tailwindcss` + `@tailwindcss/postcss`; add `postcss.config.mjs`.
- `@import "tailwindcss"` in `globals.css`; port `:root` into `@theme` with warm-rotated
  surfaces. Leave every existing rule in place — CSS Modules must keep working.
- Delete the Google Fonts `@import`. Wire Anuphan + IBM Plex Sans Thai + Plex Mono via
  `next/font/google` with `subsets: ['thai','latin']`.
- Replace hand-written viewport `<meta>` with Next's `viewport` export
  (`viewportFit: 'cover'`, `themeColor`).
- Add `images.remotePatterns` to `next.config.mjs`.

**Exit:** a Tailwind utility renders; every screen pixel-identical except Thai text now
renders in Plex Thai; `env(safe-area-inset-bottom)` returns non-zero on a notched device.

### Phase 1 — Primitives (~3 days)

Pure presentation, zero data.
- `Button` (primary/secondary/ghost/danger, loading+disabled) — encodes fill-vs-ink rule.
- `Icon` — the 20-glyph inline SVG set.
- `Sheet` — bottom sheet with focus trap + drag-to-dismiss, reusing `useModalDismiss`.
- `Skeleton`, `EmptyState`, `ErrorPanel`, `Chip`, `Toast` + provider.

**Exit:** every primitive keyboard-navigable with visible focus ring; axe clean; correct
at 390px.

### Phase 2 — Shell & chrome (structural, highest leverage)

- Create `(app)` route group with shared `layout.tsx`; move `BottomNav` into it, remove
  from all seven pages.
- Migrate `BottomNav` to Tailwind with `pb-safe`.
- Migrate `MovieCard` (highest reuse — six screens).
- Add `app/error.tsx` and `app/not-found.tsx` (currently missing).

**Exit:** tab navigation doesn't remount the nav; nav clears the home indicator on iPhone
15; thrown errors render the boundary.

### Phase 3 — List screens (~4 days)

Order: `/discover` → `/bookmarks` → `/downloads` → `/search` → `/home`.
- `loading.tsx` per segment per the skeleton table.
- Replace empty/error states with new primitives and copy.
- Route `/search` through `apiFetch`, debounce 250ms, add empty-query state.
- Delete six `.module.css` files.

**Exit:** no route returns `null` during load; every empty state offers an action.

### Phase 4 — Detail & player (highest risk)

Decompose before restyling — `PlayerClient` mixes HLS lifecycle, entitlement, watch-history
reporting, and presentation in one ~600-line component.
1. No visual change: extract `useHlsPlayer`, `useEntitlement`, `useWatchProgress`,
   `useMovieActions`. Verify against the e2e entitlement suite before touching a class name.
2. Migrate `/movie/[id]` + `InfoModal` to Tailwind + `Sheet`.
3. Rebuild player shell on the three-zone model.
4. Rebuild the gate as a balance-branched sheet.

**Exit:** `test/entitlement.e2e-spec.ts` green and unmodified; free/subscription/coin-gated/
insufficient-balance all verified by hand; controls auto-hide/recall; no layout shift.

### Phase 5 — Commerce & account

- Rebuild `/subscribe`: one honest notice, preview cards with "เร็ว ๆ นี้" chips.
- Build checkout flow behind `PAYMENTS_ENABLED=false`.
- Wallet view over the `UserCoin` ledger.
- `/profile`: cut ten inert rows, keep three with schema behind them; surface coin balance
  in the header.
- `/login` + `/register` (deferred deliberately — seen once, lowest-value styling work).

**Exit:** no disabled control without an adjacent alternative.

### Phase 6 — Motion & teardown

- Enable `experimental.viewTransition`; add the two shared-element morphs.
- Add `motion` via `LazyMotion` for sheet drag, scrub, like burst.
- Delete the last `.module.css`; strip dead keyframes/utilities from `globals.css`.
- Full audit: axe on every route, Lighthouse on throttled 4G, reduced-motion pass,
  real-device check (iOS Safari + Android Chrome).

**Exit:** zero `.module.css` files remain; no contrast failure on any interactive element.

---

## Appendix — What this plan needs from the API

Deliberately separated — none belongs in a styling migration.

| Ask | Why the frontend needs it | Blocks |
|---|---|---|
| `GET /episodes/:id` | Player downloads the entire catalogue to find one episode | Phase 4 |
| `GET /movies?q=` | Search filters the full catalogue client-side | Phase 3 |
| Coin top-up endpoint + gateway | `POST /wallet/spend` exists; nothing grants coins | Phase 5 |
| `GET /me/coins` (ledger) | Renders wallet history; `UserCoin.balanceAfter` already stored | Phase 5 |
| `#FFD700` → `#E8B84B` in `plans.config.ts` | Plan colors are server-owned | Phase 5 |
| Poster host confirmed | Needed for `images.remotePatterns` | Phase 0 |

### Open assumptions

- **Type pairing:** Anuphan + IBM Plex Sans Thai assumed; LINE Seed Sans TH swaps in at
  no cost if brand familiarity is preferred.
- **Android browser floor:** Tailwind v4 needs Chrome 111+; confirm from analytics.
- **Payment gateway timing:** assumed not imminent; Phase 5 designs for the honest
  interim state.
- **Dark only:** schema carries `User.theme`, implying light mode is planned. This plan
  specifies dark only, built on semantic tokens (`ink`/`fg`, not `black`/`white`) so
  adding light later stays inexpensive.
