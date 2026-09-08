# Implementation Plan — Phase A (Night & Sleep) + Phase B (Time-aware)

**Source spec:** `docs/superpowers/specs/2026-09-03-newplan-design.md`
**Baseline:** `part7-art-direction` @ `3fa675b`
**Stack verified in-repo:** NestJS 11 · Prisma 7 + `@prisma/adapter-pg` · PostgreSQL · `@nestjs/cache-manager` 3 + `@keyv/redis` · Next.js (app router) · Jest (api) / Vitest (app)

---

## 0. Scope note — read before section 1

The task asks the migration section to cover `MovieMood`, `originCountry`, and `systemRating`. Per the spec these are **Phase C and Phase D**, not A/B: `MovieMood` belongs to C1 (Mood Match), `originCountry` and the rating field to D (Passport, phase 2). Phase A needs **zero** migrations and Phase B needs **one**.

They are planned anyway in §1.4 with an explicit recommendation on which to land early, because the decision is cheap now and expensive later. The A/B task breakdown in §4 does not depend on any of them.

Two naming problems to settle before those columns exist:

- `Movie.contentRating` **already exists** and holds an *age* rating string (`"ผู้ใหญ่"` in `seed.ts`). A sibling column called `systemRating` will be misread as an age rating by every future reader. Recommend `criticScore` or `editorialScore`.
- The spec's Passport line "คะแนนเฉลี่ย 8.1" is a *user* rating average — a derived aggregate, not a column. `systemRating` as described is a *platform* score. These are different features; the plan assumes the latter and flags that the former still has no design.

---

## 1. Schema Migration Strategy

### 1.1 Phase A — no migrations

Night Mode and Sleep Mode persist to `localStorage` only. No `User` columns, no API contract change, no Prisma diff. This is what makes A shippable in parallel with B.

Consequence to accept explicitly: preferences do not sync across devices. Deferred, not forgotten.

### 1.2 Phase B — Migration 1: `scene_markers`

```prisma
enum SceneMarkerKind {
  INTRO
  RECAP
  CREDITS
}

model SceneMarker {
  id           String          @id @default(uuid())
  episodeId    String
  kind         SceneMarkerKind
  startSeconds Int
  endSeconds   Int

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  episode Episode @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@unique([episodeId, kind])
  @@map("scene_markers")
}
```

Plus the back-relation on `Episode`: `sceneMarkers SceneMarker[]`.

**Index decision — one index, not two.** The spec draft listed both `@@unique([episodeId, kind])` and `@@index([episodeId])`. The second is redundant: the unique constraint's backing btree is on `(episode_id, kind)`, and PostgreSQL uses a leading-column prefix for `WHERE episode_id = $1`. Dropping it saves a write on every marker mutation. **Only `@@unique([episodeId, kind])` ships.**

**Integrity that Prisma cannot express** — add as raw SQL in the same migration:

```sql
ALTER TABLE "scene_markers"
  ADD CONSTRAINT "scene_markers_range_valid"
  CHECK ("startSeconds" >= 0 AND "endSeconds" > "startSeconds");
```

Without it a typo'd marker produces a negative `skippableSeconds`, which silently corrupts every ETA on the platform. A CHECK constraint is the cheapest possible place to stop that.

**Unit boundary — decide once, document in the schema.** `Episode.durationMinutes` is `Int` minutes; markers are `Int` seconds. The rule: *markers and player positions are seconds; runtime and filtering are minutes; ETA rounds to the nearest minute on output.* No `durationSeconds` column in Phase B — minute precision is exactly right for "จบประมาณ 22:07".

**Backfill:** none. Zero rows is a valid, fully-supported state (no markers → no skip button → ETA subtracts nothing). This must be a tested path, not an accident.

### 1.3 Phase B — Migration 2: the `fits` query index

`GET /discovery/fits` filters episodes by `durationMinutes` among live episodes of published movies. Prisma cannot express a partial index, so this migration is hand-written SQL:

```sql
CREATE INDEX "episodes_duration_live_idx"
  ON "episodes" ("durationMinutes")
  WHERE "deletedAt" IS NULL;
```

Partial rather than composite because `deletedAt IS NULL` is true for nearly every row — a `(deletedAt, durationMinutes)` composite wastes space on a column with one useful value.

No new index needed for the `next_episode` resolution: `WatchHistory` already carries `@@index([userId, updatedAt])`, which is the exact access path.

Prisma note: declare it in `schema.prisma` as `@@index([durationMinutes])` **or** leave it schema-invisible and add `-- prisma-migrate: custom` in the SQL. Prefer the second and add a comment, so `prisma migrate diff` doesn't try to replace the partial index with a full one on the next generate.

### 1.4 Phase C/D columns — recommendation

| Object | Land it now? | Reasoning |
|---|---|---|
| `Movie.originCountry String?` | **Yes** | Additive, nullable, no backfill risk, no writer needed. Costs one line; unblocks Passport later without another migration window. Use ISO 3166-1 alpha-2 (`"KR"`), not a display string. |
| `Mood` + `MovieMood` | **No** | An empty join table with no tagging UI and no reader is dead schema. It also invites someone to auto-derive moods from genres, which the spec explicitly forbids. Create it in the C1 migration, alongside the code that fills it. |
| `systemRating` / `criticScore` | **No** | Its semantics are undefined until the rating feature is designed (platform score vs. user-average — see §0). A nullable numeric with no defined meaning will be populated inconsistently. |

If `originCountry` lands, it goes in **Migration 1** as a second statement — one migration, not two, since neither has a backfill step.

---

## 2. API & Cache Design

### 2.1 The cache invariant

`MoviesService` caches a single shared slot: `movies:all`, 5-minute TTL, invalidated by `create()`. It is served from `@Public()` routes, so it is shared by every anonymous and authenticated caller alike.

**The invariant to write down and enforce:**

> Anything reachable through a `@Public()` cached response must be a pure function of content state. If a value can differ between two users, it may not enter `movies:all`.

Violating it does not produce a stale-data bug — it produces one user's watch history rendered on another user's screen. That is the whole reason `/me/watch-status` is a separate endpoint rather than three extra fields on `Movie`.

### 2.2 Three tiers

| Tier | Routes | Auth | Cacheable | Phase |
|---|---|---|---|---|
| **1 — Content** | `GET /movies`, `/movies/:id`, `/movies/:id/similar`, `GET /episodes/:id` | `@Public()` | Yes, shared slot | existing |
| **2 — Personal** | `GET /discovery/fits`, `GET /me/watch-status` | Global `JwtAuthGuard` | **No** | B / C |
| **3 — Entitlement** | `GET /playback/:episodeId/authorize` | Guard + subscription check | No | existing, untouched |

`SceneMarker` is **Tier 1**. Markers are timing metadata about content, identical for every viewer — unlike `videoUrl`, which `movies.service.ts:65` (`toDto`) strips because it is the one field that actually grants viewing. Markers ride in the cached payload and need no separate fetch.

That has one consequence: **admin marker mutations must invalidate `movies:all`**, exactly as `MoviesService.create()` does today, using the same `try/catch` + `logCacheFailure` treatment so a Redis outage degrades instead of failing the write.

### 2.3 Module and controller structure

```
apps/flick-api/src/
├── scene-markers/                  # NEW — Phase B
│   ├── scene-markers.module.ts
│   ├── scene-markers.service.ts    # CRUD + skippableSeconds aggregation
│   ├── scene-markers.admin.controller.ts   # @Roles(Role.ADMIN)
│   └── dto/upsert-scene-marker.dto.ts
├── discovery/                      # NEW — Phase B3
│   ├── discovery.module.ts
│   ├── discovery.service.ts        # the "fits" resolver
│   ├── discovery.controller.ts     # NOT @Public()
│   └── dto/fits-query.dto.ts
├── movies/movies.service.ts        # MODIFIED — markers in toDto, cache key unchanged
└── engagement/                     # MODIFIED — Phase C endpoint lands here
    └── engagement.controller.ts    # + GET /me/watch-status
```

Both new modules register in `app.module.ts` alongside `EngagementModule`. The three global guards (`ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`, in that order) already cover them; no route-level auth decorators are needed except `@Roles(Role.ADMIN)` on the admin controller and the deliberate *absence* of `@Public()` on discovery.

**Why a separate `DiscoveryModule` rather than a `/movies` query param:** `findAll(q)` already bypasses the cache when `q` is present, so a param would work mechanically. It is rejected because it would put a personalized, auth-required branch inside a `@Public()`-decorated handler — one refactor away from someone caching it. The tier boundary should be visible in the route table, not buried in a conditional.

### 2.4 Contracts

**Marker mutation (admin only):**

```
PUT    /admin/episodes/:episodeId/markers/:kind    → upsert  { startSeconds, endSeconds }
DELETE /admin/episodes/:episodeId/markers/:kind
GET    /admin/episodes/:episodeId/markers
```

`PUT` keyed on `(episodeId, kind)` maps straight onto the unique constraint, making the operation idempotent — a retried request cannot create a duplicate intro.

**Marker read shape** (embedded, Tier 1):

```ts
interface SceneMarkerDto {
  kind: 'INTRO' | 'RECAP' | 'CREDITS';
  startSeconds: number;
  endSeconds: number;
}
// Episode gains: markers: SceneMarkerDto[]
```

Must flow through **both** DTO mappers, or the shapes diverge: `MoviesService.toDto()` and `EngagementService.toContinueWatchingDto()` (`engagement.service.ts:163`). Both already hand-strip `videoUrl`; markers get added in the same two places.

**`GET /discovery/fits?maxMinutes=30`:**

```ts
interface FitsResponse {
  items: Array<{
    movie: Movie;
    episode: Episode;
    kind: 'film' | 'next_episode' | 'first_episode';
    runtimeMinutes: number;     // durationMinutes − ceil(skippableSeconds / 60)
    finishesAtHint: string;     // ISO; client formats "จบ 22:07"
  }>;
}
```

`maxMinutes` validated as an enum-ish whitelist (`15 | 30 | 60 | 90`) via a `class-validator` DTO, not a free integer — an open numeric range invites a scan and gives no product benefit.

**`GET /me/watch-status?movieIds=a,b,c`** (Phase C feature; its cache architecture is settled here because `/discovery/fits` sets the precedent):

```ts
type WatchStatusResponse = Record<string, {
  state: 'none' | 'partial' | 'watched';
  percent: number;              // 0–100
  lastWatchedAt: string | null;
}>;
```

Three rules that will otherwise produce wrong numbers:

1. Cap `movieIds` at 50 per request (DTO-validated, `400` past it). An unbounded `IN (…)` from a query string is a trivially abusable scan.
2. Denominator must exclude soft-deleted episodes (`deletedAt: null`) — otherwise `percent` can exceed 100 after a takedown.
3. `completed === true` pins `percent` to 100 regardless of `progressSeconds`. A user who skips credits and closes the app leaves `progressSeconds` at ~94%; showing "ดูถึง 94%" for a finished title is the bug this rule prevents.

### 2.5 Enforcing the invariant in CI

Two tests, both cheap, both catching a class of bug rather than an instance:

- **Unit (`movies.service.spec.ts`)** — assert the cached DTO's key set matches an explicit allowlist. Any future field added to the movie payload fails the test until someone consciously classifies it as content or personal.
- **E2E (`test/movies.e2e-spec.ts`)** — user A records watch progress; user B requests `/movies`; assert B's response body contains no `watch`/`progress`/`percent` key at any depth. This is the test that would have caught the leak directly.

---

## 3. UI / State Logic

### 3.1 Preference store — build once, in Phase A

Both phases need client preferences, so define the whole shape up front even though `autoSkip` is unused until B:

```ts
// apps/flick-app/src/features/preferences/
interface Prefs {
  night: boolean;
  autoplayNext: boolean;   // Night Mode forces false
  autoSkip: boolean;       // Phase B
}
// localStorage key: "flicer.prefs"  (single JSON blob, one migration surface)
```

Every read and write wrapped in `try/catch`. Private-browsing and storage-blocked contexts **throw on access**, not merely return null — an unguarded read crashes the player for those users. Default `Prefs` renders correctly when storage is unavailable.

Exposed via one `PreferencesProvider` context in `app/(app)/layout.tsx`, so no component prop-drills a theme flag.

### 3.2 Wall-clock Sleep Timer

**Single source of truth:** an absolute epoch timestamp, never a remaining-duration counter.

```ts
// localStorage
"flicer.sleep" → { mode: 'timer', deadlineMs: number }
              | { mode: 'end-of-episode' }
              | null
```

**Why wall-clock:** on mobile, background tabs have their timers throttled or frozen outright. A `setTimeout(30 * 60_000)` fires late by an unbounded amount. Storing the deadline means every recomputation is `Date.now() >= deadlineMs` — correct regardless of what the browser did while suspended.

`setTimeout` is still used, but only as a *wake-up hint* for the next transition. Authority always rests with a fresh `Date.now()` comparison, recomputed on: mount, `visibilitychange` → visible, `pageshow` (bfcache restore), and each countdown tick.

**Phase machine — a pure function, no DOM:**

```ts
// features/playback/sleepPhase.ts
type SleepPhase = 'idle' | 'armed' | 'warning' | 'fading' | 'expired';
export function sleepPhase(nowMs: number, deadlineMs: number | null): SleepPhase;
// armed → warning at T−60s → fading at T−20s → expired at T
```

Fully unit-testable with Vitest by passing numbers. All timing logic lives here; the hook is a thin subscriber.

**Play/pause semantics — the decision that has to be made explicitly:**

> The deadline is **absolute**. Pausing does **not** extend it.

The user's stated intent is "ฉันจะนอนใน 30 นาที" — a statement about their bedtime, not about consuming 30 minutes of film. A pause-aware timer would also need to track accumulated playing time across suspend/resume, reintroducing exactly the drift that wall-clock storage eliminates. Absolute wins on both correctness and intent.

Edge case that falls out cleanly: if the video is already paused at expiry, `pause()` is a harmless no-op, and we still flush progress and dim. No special-casing.

**Volume fade — three concrete hazards:**

1. **Snapshot the user's volume at fade start.** Ramping `video.volume → 0` and then cancelling without restoring the captured value leaves the user silently muted for the rest of the session. The captured value is also what a cancel restores to, not `1.0`.
2. **iOS Safari makes `HTMLMediaElement.volume` read-only.** Assignment silently no-ops. Feature-detect once (write a test value, read it back); if unsupported, skip the fade and go straight to the pause step rather than shipping a fade that appears broken on roughly half the target devices.
3. Drive the ramp with `requestAnimationFrame`, not a 20-second CSS transition or an interval — rAF pauses with the tab, and the wall-clock check on resume corrects the position anyway.

**Expiry sequence — order is load-bearing:**

```
1. video.pause()
2. flush PUT /me/watch-history/:episodeId   ← via existing useWatchProgress flush path
3. dim the screen / show the resume affordance
```

Progress must be written **before** any animation. Getting this backwards recreates the exact bug the feature exists to fix: the user falls asleep, and the app loses their position.

**`end-of-episode` mode** uses no timer at all — it sets a flag consumed by the autoplay-next handler. Different mechanism, same UI entry point.

**Cancellation:** any pointer/key interaction during `warning` or `fading` clears the deadline and restores the snapshotted volume.

**Reduced motion:** `prefers-reduced-motion` collapses the fade to an instant transition. The 60-second warning card still appears — it is information, not decoration.

**Hook placement:** `features/playback/hooks/useSleepTimer.ts`, beside the existing `useWatchProgress.ts` and `useHlsPlayer.ts`.

### 3.3 Night Mode — scope and the video boundary

**Mechanism: CSS custom property overrides, not a filter.**

```css
/* globals.css — override existing token names, do not create a parallel palette */
:root[data-night="on"] {
  --color-fg:        #C9C2BC;   /* was #FFFFFF */
  --color-fg-dim:    #857D77;
  --color-fg-mute:   #5C554F;
  --color-brand:     #C24512;   /* was #FF5C1A */
  --color-brand-ink: #B4623F;
  --color-subtitle:  #C9C2BC;   /* NEW token, see below */
  --shadow-surface:  0 16px 40px -18px rgba(0, 0, 0, 0.9);
}
```

Overriding the *existing* token names means every component already consuming `--color-fg` dims for free. No component is modified, and nothing can be accidentally left bright.

**Why this approach is the architecture, not just an implementation detail:** the requirement is "dim the UI chrome without touching the video." A `filter: brightness()` on a page-level wrapper, or a fixed dark overlay, dims *everything inside it* — including the `<video>` — and destroys the film's color grade. There is no clean way to punch a hole back through it (`filter` creates a containing block; z-index escapes fight the overlay).

Token overrides cannot reach the video **by construction**: a `<video>` element renders decoded frames, not CSS colors. Nothing in the override block applies to it. The boundary is enforced by the mechanism rather than by a rule someone has to remember.

Guardrail to make that explicit and testable: a Vitest assertion that the `[data-night="on"]` block contains no `filter`, `opacity`, or `backdrop-filter` declaration. It reads as pedantic until the first person reaches for `filter: brightness(0.8)`.

**Subtitles** are DOM/track-rendered chrome, not video pixels, so they are in scope. They currently inherit `--color-fg` (pure white, harsh at night). Introduce `--color-subtitle`, default it to `#FFFFFF` in the base `:root`, point the subtitle renderer at it, then let night mode lower it. This is a small refactor in Phase A that B does not depend on.

**Flash-of-bright prevention:** set `data-night` in a blocking inline script in `app/layout.tsx` before first paint, reading `localStorage` directly — the same pattern a theme toggle uses. Doing it in a `useEffect` guarantees a white flash on every load, which is the single most annoying possible bug in a feature about not being blinded at night.

**Coupled side effects when Night Mode turns on:** `autoplayNext → false`, UI sound/haptics off. These are `Prefs` writes, not separate state.

**One-time suggestion:** if local hour ∈ [22, 05) and `flicer.night.suggestedAt` is unset, offer once and write the key **immediately on display** — not on the user's answer. Dismissal is permanent. Re-asking nightly is worse than never asking.

### 3.4 Finish-time (Phase B, client)

```ts
// features/playback/finishTime.ts
export function estimateFinishTime(input: {
  now: Date;
  remainingSeconds: number;
  skippableSeconds: number;
  autoSkip: boolean;
  playbackRate: number;
}): { finishesAt: Date; savedSeconds: number };
```

Pure, Vitest-covered, no DOM. **Recomputed every time the overlay opens** — never pinned at play time, or a ten-minute pause leaves a confidently wrong ETA on screen. `playbackRate` is included from day one because it is one multiplication and omitting it makes the number wrong for anyone using 1.25×.

Rendered in two places: the movie detail page pre-play (`"1 ชม 47 นาที · เริ่มตอนนี้จบ 22:07"`) and the player overlay (`"จบ 22:07"` + `"ข้าม intro/credits แล้วเร็วขึ้น 4 นาที"` when `autoSkip` is on).

### 3.5 Frontend type-layer changes (Phase B)

`apps/flick-app/src/types/` is a hand-written runtime-validated contract, not generated — three files change together or decoding throws:

- `index.ts` — add `SceneMarkerDto`, `Episode.markers`, `FitsResponse`, `WatchStatusResponse`.
- `api.ts` — extend the `ApiPath` union and the `ApiResponse` conditional, add `decodeFits` / `decodeWatchStatus`, and extend `decodeEpisodeDetail` to validate `markers` (array, and each entry's `kind` against the three literals).
- `api.test.ts` — a rejection case per new decoder.

---

## 4. Task Breakdown

Phases A and B touch disjoint files and can run in parallel; A is frontend-only.

### Phase A — Night & Sleep (no backend, no migration)

- [ ] **A1** `PreferencesProvider` + `flicer.prefs` store; `try/catch` on every access; unit tests for the storage-throws path.
- [ ] **A2** Add `--color-subtitle` to base `:root`; point the subtitle renderer at it.
- [ ] **A3** `:root[data-night="on"]` token override block in `globals.css`.
- [ ] **A4** Pre-paint inline script in `app/layout.tsx`; verify no flash on hard reload.
- [ ] **A5** Night Mode toggle in the player overlay + profile; wire the `autoplayNext → false` coupling.
- [ ] **A6** Guard test: `[data-night]` block contains no `filter` / `opacity` / `backdrop-filter`.
- [ ] **A7** `sleepPhase()` pure function + Vitest table covering all four transitions and `deadline === null`.
- [ ] **A8** `useSleepTimer()` — wall-clock authority; recompute on mount, `visibilitychange`, `pageshow`.
- [ ] **A9** Sleep picker UI (15 / 30 / 60 / จบตอนนี้).
- [ ] **A10** Volume fade: snapshot-and-restore, rAF ramp, iOS read-only feature detection with skip-fade fallback.
- [ ] **A11** Expiry sequence in order — `pause()` → flush watch-history → dim. Test asserts the progress write precedes the dim.
- [ ] **A12** Cancellation path restores the snapshotted volume; covered by test.
- [ ] **A13** `end-of-episode` mode via the autoplay-next flag (no timer).
- [ ] **A14** One-time night suggestion; `suggestedAt` written on display, not on answer.
- [ ] **A15** `prefers-reduced-motion` pass; a11y check on the warning card (announced, focusable, dismissible).

**Phase A done when:** the deadline survives a 10-minute background suspend on a real device; progress is written before dimming; the video's rendered colors are byte-identical with night mode on and off.

### Phase B — Time-aware

**B0 — foundation**

- [ ] **B0.1** `SceneMarkerKind` enum + `SceneMarker` model + `Episode.sceneMarkers` back-relation; `originCountry String?` if §1.4 is accepted.
- [ ] **B0.2** Migration: table + `@@unique([episodeId, kind])` + the `scene_markers_range_valid` CHECK, hand-added to the generated SQL.
- [ ] **B0.3** Migration: partial index `episodes_duration_live_idx`, with the Prisma-diff comment.
- [ ] **B0.4** Seed markers for the existing fixture titles in `prisma/seed.ts` (respecting its delete-by-id idempotency block).
- [ ] **B0.5** `SceneMarkersModule` + service: CRUD and `skippableSeconds(episodeId)`.
- [ ] **B0.6** Admin controller (`@Roles(Role.ADMIN)`), idempotent `PUT` keyed on `(episodeId, kind)`; DTO validation rejects `endSeconds <= startSeconds` before the DB does.
- [ ] **B0.7** Marker mutations invalidate `movies:all` with the existing `logCacheFailure` treatment.
- [ ] **B0.8** Expose `markers` through **both** `MoviesService.toDto()` and `EngagementService.toContinueWatchingDto()`.
- [ ] **B0.9** Frontend types + decoders + rejection tests (§3.5).
- [ ] **B0.10** Cache-invariant tests: DTO key allowlist unit test + cross-user `/movies` e2e leak test.

**B1 — finish time**

- [ ] **B1.1** `estimateFinishTime()` + Vitest table: zero markers, `autoSkip` off, `playbackRate` ≠ 1, progress ≠ 0.
- [ ] **B1.2** ETA on the movie detail page pre-play.
- [ ] **B1.3** ETA in the player overlay, recomputed on open (test asserts a second open after a simulated pause yields a later value).

**B2 — smart skip**

- [ ] **B2.1** Skip button appears while `currentTime` is inside a marker, disappears on exit.
- [ ] **B2.2** `autoSkip` preference (default **off**); auto-jump on marker entry when on.
- [ ] **B2.3** Zero-marker regression test: no button, ETA subtracts nothing, nothing throws.

**B3 — the "fits" filter**

- [ ] **B3.1** `DiscoveryModule` + `FitsQueryDto` (whitelisted `maxMinutes`).
- [ ] **B3.2** Resolver: `film` / `next_episode` / `first_episode` selection; `next_episode` reads `WatchHistory` on the existing `[userId, updatedAt]` index.
- [ ] **B3.3** Route test asserting `/discovery/fits` returns **401** anonymously — the regression guard against someone adding `@Public()` for convenience.
- [ ] **B3.4** Filter sheet UI (time row; mood row stubbed for Phase C).
- [ ] **B3.5** Result rows render `runtimeMinutes` + `"จบ 22:07"` from `finishesAtHint`.

**B4 — watch state (Phase C feature; cache architecture settled here)**

- [ ] **B4.1** `GET /me/watch-status` on `EngagementController`; `movieIds` capped at 50.
- [ ] **B4.2** Percent computation: `deletedAt: null` denominator, `completed → 100` pin. Unit tests for both.
- [ ] **B4.3** Client-side merge of the two responses; verify nothing personal reaches the `/movies` cache path.

**Phase B done when:** `prisma migrate deploy` runs clean on a copy of production; ETA is accurate to ±1 minute against a stopwatch on a marked title; an unmarked title behaves identically minus the skip affordance; the cross-user leak e2e passes.

---

## 5. Open questions blocking execution

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | Confirm episode-level filtering for `/discovery/fits` | B3 | Proceed as specced; movie-level would let the route be `@Public()` and cached, but drops all series from the filter |
| 2 | Who authors `SceneMarker` rows for real content? | B0.4 value, not correctness | Ship the admin API + seed fixtures; feature degrades correctly with no data |
| 3 | Does Sleep Mode's absolute deadline match intent, or should pausing extend it? | A8 | Absolute (§3.2) |
| 4 | Land `originCountry` in Migration 1? | B0.1 | Yes — additive and nullable |
| 5 | `systemRating`: platform score or user-rating average? | Neither A nor B | Defer; naming collision with `contentRating` unresolved (§0) |

---

## 6. Principal risks

| Risk | Mitigation |
|---|---|
| Personal data leaks into `movies:all` | Two CI tests in §2.5; tier table in the route documentation |
| iOS silently ignores the volume fade | Feature-detect and fall back to hard pause (§3.2) |
| Backgrounded timer fires late | Wall-clock authority; `setTimeout` demoted to a hint |
| Night Mode dims the film | Token overrides only; CSS-declaration guard test (§3.3) |
| Sleep expiry loses progress | Ordered expiry sequence, asserted by test (A11) |
| Bad marker data corrupts every ETA | DB CHECK constraint + DTO validation (B0.2 / B0.6) |
| `markers` added to one DTO mapper, not both | B0.8 treats them as one task; decoder rejection tests catch the divergence |
