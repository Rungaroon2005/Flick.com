# Flick UX/UI improvement: the return-to-intent pass

> A presentation-layer design for the unified app. It draws the same boundary
> `docs/FRONTEND_PLAN.md` and the responsive spec drew — no task changes an
> entitlement check or an API contract — with two exceptions logged in the
> Appendix as backend asks.
>
> **Baseline:** `integration/unify` @ `0538426` — the first tree that holds the
> Cinnabar design system, the responsive pass, OTP auth, and Omise payments at
> once. Verified green: `flick-app` build + 29 vitest, `flick-api` 180 jest +
> 21 e2e, both lints.
>
> **Verified against:** Next.js 16.2.12 · Tailwind CSS 4.3.3 · 25 Aug 2026

---

## Prologue: the app has no memory of intent

This is not a collection of screen problems. It is one defect with eleven call
sites, and it sits directly across the path that earns money.

| Where | Code | What the user loses |
|---|---|---|
| 11 auth redirects | `redirect('/login')` — **none** carries a destination | The episode they deep-linked to |
| OTP verify | `login/page.tsx:58` — `router.replace(result.isNewUser ? '/subscribe' : '/home')` | The destination again, plus a working back button |
| Checkout success | `subscribe/processing/page.tsx:52` — `router.replace('/home')` | The episode they **just paid to unlock** |
| Gate escapes | `PlayerClient.tsx:378`, `:403`, `:411` → `/subscribe`; `:375` → `/discover` | The episode the sheet is selling |

A user who wants one specific episode and meets any gate is returned to the
lobby and made to search for it again — after paying. The payments work that
just merged lengthened this round trip rather than closing it.

Everything else in this document is real, smaller, and sequenced behind it.

**What is already right and must survive:** the balance-branched gate sheet with
its visible arithmetic (`◆320 → ◆310`, `PlayerClient.tsx:383-390`); the OTP
inputs' `type="tel"` / `inputMode="numeric"` / `autoComplete="one-time-code"`
(`login/page.tsx:103-122`); search's recent-queries store and its no-match state
with three genre fallbacks (`SearchClient.tsx:157-164`); the
`[@media(hover:hover)]` guards; `pt-safe`/`pb-safe`; the `prefers-reduced-motion`
floor; the `aspect-[9/16]` stage box. None of this is touched.

---

## Part 1 — The spine: return-to-intent

One contract, threaded through all four handoffs. Everything else in the funnel
is downstream of it.

### The contract

A single optional `next` search param, carrying a **path within the app only**.

```ts
// lib/next-param.ts — the whole contract lives in one file
export function withNext(base: string, next: string | null): string
export function safeNext(raw: string | null): string | null  // null unless it
                                                             // starts with '/'
                                                             // and not '//'
```

`safeNext` rejecting anything that is not a single-slash-prefixed relative path
is the entire open-redirect defence. It is four lines and it is not optional:
`next` is attacker-controllable via a link.

### The four handoffs

1. **Gate the route, keep the target.** All 11 `redirect('/login')` sites become
   `redirect(withNext('/login', pathname))`. Server components read the path
   they were rendering.
2. **Return after verify.** `login/page.tsx:58` resolves `safeNext(...)` first.
   New users still meet `/subscribe`, but with `next` forwarded through it —
   plan selection is a step on the way to the episode, not a destination that
   replaces it.
3. **Sell without leaving.** The gate sheet's three `/subscribe` pushes carry
   `next` set to the current episode.
4. **Land where they paid to be.** `rememberPendingCheckout` already persists a
   `CheckoutBaseline` across the gateway redirect. Extend that record with
   `next`, and `processing/page.tsx:52` resolves to it instead of `/home`.

### Back must work

`router.replace` at `login/page.tsx:58` and `processing/page.tsx:52` erases the
step from history. Post-verify, `replace` is correct — nobody should be able to
navigate back into a consumed OTP screen. Post-checkout it is wrong: replace it
with `push`, so back returns to the episode rather than the gateway.

`LogoutButton.tsx:21` keeps `replace`, and correctly so.

### Testing

Unit-test `safeNext` against `//evil.com`, `https://evil.com`, `/home`, `null`,
and `''`. One integration test per handoff asserting the destination survives.
The existing e2e entitlement suite must stay green and unmodified.

---

## Part 2 — Four accessibility defects, each verified against a guideline

Sourced from the `ui-ux-pro-max` UX guideline set, then confirmed in this tree.
Listed by severity.

### 2.1 Focus rings exist on almost nothing (High)

Three `focus-visible` occurrences in the entire `src/` tree, in three files:
`globals.css`, `BottomNav.tsx`, and `Button.tsx`. `Button` is correct —
`focus-visible:outline-2 focus-visible:outline-offset-2 outline-brand-ink`.

Everything that is not a `Button` has no keyboard focus indicator at all:
`AppHeader`'s two action links and the coin-balance link, `Chip`,
`ReactionButton`, `MovieCard`, every player control, the free-plan button in
`SubscribeClient`, and the login back-link.

**Fix:** lift `Button`'s focus treatment into a `.focus-ring` utility in
`globals.css` and apply it to every interactive element. One utility, not a
per-component judgement call — the same reasoning that put the contrast rule
inside `Button` in the first place.

### 2.2 Both auth inputs fail focus appearance (High)

`login/page.tsx:106` and `:124` set `outline-none` and signal focus only with
`focus:border-brand-ink` — a 1px border colour change. The guideline requires a
2px perimeter at 3:1 state contrast. A 1px border swap on a dark ground is not
a focus indicator.

**Fix:** the same `.focus-ring` utility. Keep the border tint; add the ring.

### 2.3 Sticky chrome can obscure focus — WCAG 2.2 AA (High)

`globals.css` has no `scroll-padding-top`. `AppHeader` is `sticky top-0 z-[100]`
at a fixed `h-16`, and `SearchClient`'s filter bar sticks beneath it at
`top-16`. Tabbing to a control just below the fold scrolls it under the header.

**Fix:** `scroll-padding-top: 4rem` on the root, `8rem` on `/search` where two
sticky bars stack. `AppHeader`'s comment already warns that `h-16` is
load-bearing for the search offset; this adds a third consumer, so the height
becomes a token (`--spacing-header`) rather than a number repeated in three
places.

### 2.4 Placeholder is the only visible label (High)

Both OTP inputs carry `aria-label` and a `placeholder` but no visible `<label>`.
Screen-reader users are served; sighted users lose the field's identity the
moment they type — worst on the code step, where `placeholder="000000"`
disappears behind the first digit and the field becomes six unlabelled boxes.

**Fix:** visible `<label>` above each field. The Thai copy already exists in the
`aria-label`s.

---

## Part 3 — The feedback channel that was specified and never built

`FRONTEND_PLAN.md` Part 3 specified a Toast provider with a 4s auto-dismiss and
a queue. **Zero references exist in `src/`.** Consequences today:

- The player's `notice` is a bare `<p>` at `PlayerClient.tsx:424` that clears
  only on the next action, and can sit over a scene for the rest of an episode.
- A coin unlock succeeds silently.
- Checkout now has genuinely async outcomes and nowhere to report a transient
  failure — `processing/page.tsx` swallows poll errors by design, correctly,
  but then has no channel to say "still working."

**Build:** `ToastProvider` in the `(app)` layout and the standalone routes,
`useToast()`, 4s auto-dismiss, queue, `role="status"`, pause on hover/focus,
dismissible. Retire the ad-hoc `notice` paragraph. Under
`prefers-reduced-motion` it appears without translation — the existing blanket
floor already covers this.

---

## Part 4 — Search that survives a real catalogue

`search/page.tsx:8` fetches **the entire `/movies` catalogue** with
`revalidate: 60`, and `SearchClient.tsx:81-88` filters it in memory by
substring over title and genre name.

The in-file comment at `:73` is honest and correct *given its constraint*:
debouncing a synchronous `useMemo` would only add typing lag. The constraint is
the problem, not the reasoning. Consequences: payload grows with the catalogue,
episodes can never be matched, and ranking is impossible.

**Fix:** `GET /movies?q=` (Appendix), a 250ms debounce once the call is a
network call, `apiFetch` instead of raw `fetch`, and a request-cancellation
guard matching every other screen in the app. Keep the recent-searches store,
the genre shortcuts, and the no-match state exactly as they are — that work is
already right.

---

## Part 5 — Downloads: make the promise real, in two steps

`/downloads` has already left the tab bar — `navItems.ts` carries four tabs
(หน้าหลัก, แนะนำ, บันทึก, โปรไฟล์) — but survives as an `AppHeader` action
(`AppHeader.tsx:13`) behind a download icon. The screen itself states
"ยังไม่รองรับการรับชมแบบออฟไลน์" (`DownloadsClient.tsx:25`).

It is a saved-for-later list wearing a download icon. A download affordance
that cannot produce an offline file is the clearest broken promise left in the
app now that `/subscribe` works.

**Both, in sequence.** The rename lands here; real offline playback is
committed as its own spec.

**5a — Rename now (this spec, Phase 4).** `/downloads` becomes "รายการของฉัน",
the `AppHeader` icon moves off `download`, and the PUT stays as-is. This costs
an afternoon and stops the app promising something it cannot do *today*. It is
not throwaway work: the saved-list surface is what offline downloads will
attach to.

**5b — Offline playback (separate spec).** This is a new subsystem, not a
presentation change, and it collides with an invariant this codebase enforces
deliberately:

> `PlaybackService` is the **only** server-side path that ever returns a real
> `videoUrl` (`playback.service.ts:25-26`), and `MoviesService.toDto` strips it
> from every other response. Entitlement is checked on the way through.

Caching an episode for offline playback puts that file on the device *outside*
that gate. Unencrypted, offline downloads are a redistribution channel for
premium content — the entitlement check becomes advisory the moment the bytes
land. `Download.expiresAt` already exists in the schema
(`schema.prisma:383`), which shows the model anticipated a licence window, but
an expiry a client enforces on itself is a courtesy, not a control.

What 5b needs, none of which exists today: a service worker and PWA manifest
(`public/` holds only `posters` and `videos`), segment storage with quota
management and resumable partial downloads, client-side licence expiry, and a
content-protection decision (see Open Questions). Sequenced after this spec's
Phase 6, with its own design doc.

---

## Part 6 — Sell inside the episode

The gate sheet is the best-designed surface in the app: it branches on balance,
shows the arithmetic, and keeps the poster visible behind it because that is
the sales argument. Its only flaw is that every escape leaves.

**Fix:** inline the plan comparison from `GET /plans` inside the sheet, as
`FRONTEND_PLAN.md` Part 3 originally specified. With Part 1's `next` contract
this becomes genuinely optional rather than load-bearing — but the sale closes
without the stage ever leaving the screen, which is the point.

`ดูตอนฟรี` at `PlayerClient.tsx:375` should route to the free episodes of *this
movie*, not to `/discover`. Sending someone who wants episode 14 to the
discovery feed is the intent-loss defect in miniature.

---

## Part 7 — Art direction, and a recommendation rejected on the record

The `ui-ux-pro-max` design-system query for a dark entertainment product
returned: **Dark Mode (OLED)** style, **Hero-Centric** pattern, palette
`#0F0F23` / `#1E1B4B` / accent `#E11D48` ("Cinema dark + play red"), typography
**Inter / Inter**.

**The pattern and style are already implemented.** The app is OLED-dark and
hero-centric; `/home` and the landing page were rebuilt as portrait showcases in
`a45c59f` and `f44e5ef`.

**The palette and typography are rejected, for documented reasons:**

| Recommendation | Why it is wrong here |
|---|---|
| `#0F0F23` ground, `#1E1B4B` secondary | These are the blue-violet navies `FRONTEND_PLAN.md` Part 1 documents as reading *muddy* beside a warm brand hue — the exact `#1A1A2E`/`#252540` pair the Cinnabar pass replaced. Re-adopting them re-introduces the fault by name. |
| `#E11D48` accent | Untested against this app's inks. `#FF5C1A` is measured: 6.44:1 with `text-ink`, and the fill-versus-ink split is encoded in `Button` so it cannot be reached for wrong. |
| **Inter** | **Inter carries no Thai glyphs.** The app declares `lang="th"` and every string is Thai. This is the precise Critical defect the type migration fixed by moving to IBM Plex Sans Thai + Anuphan. Adopting Inter would silently break every Thai string back to an OS fallback. |

A generic streaming palette is not measured against Thai type or against a warm
ground. The existing system is. **Keep the Cinnabar palette and type stack.**

### Where identity is actually thin

Flick reads as a well-executed dark streaming app rather than as itself. The
system is correct but anonymous; the distinctiveness budget should be spent on
form, not on re-picking colours:

- **Portrait is the format.** Flick is 9:16 short-film; every competitor is
  16:9. The poster fan, the card geometry, and the shelf rhythm should make
  that unmistakable in the first viewport. It is the one structural thing no
  competitor can copy without rebuilding their catalogue.
- **One flourish, already chosen.** `reaction-pop` + `reaction-ring` is the
  app's single deliberate piece of character. Do not add a second; make that
  one excellent.
- **The coin economy is a second visual language.** `--color-coin` is
  deliberately separable from the brand. Gold should read as *earned currency*
  wherever it appears — a consistent treatment for balance, cost, and unlock,
  not just a colour.
- **Thai typography is an asset, not a constraint.** Anuphan at display sizes
  is genuinely distinctive; the app currently under-uses it.

No new colour tokens. No second animation library.

---

## Sequencing

Part 1 first, and alone, because every later part assumes it.

| Phase | Contents | Rationale |
|---|---|---|
| **1** | Part 1 (return-to-intent) | The spine. Unblocks 6. |
| **2** | Part 2 (accessibility) | Independent, mechanical, High severity. Parallelisable. |
| **3** | Part 3 (toasts) | Needed before 4 and 6 have anywhere to report outcomes. |
| **4** | Part 4 (search) + Part 5a (downloads rename) | Independent of each other and of the funnel. Part 4 blocked on the API ask. |
| **5** | Part 6 (inline plans) | Wants Part 1 and Part 3 in place. |
| **6** | Part 7 (identity) | Last, deliberately. Polish applied to a maze is wasted. |
| **—** | Part 5b (offline playback) | **Own spec, after Phase 6.** Blocked on the content-protection decision. |

**Rules of engagement**, unchanged from the two prior specs: one concern per
commit; `npm run lint && npm run build` green before every commit; API suites
green and untouched; visual check at 390 / 834 / 1440 for anything that moves.

---

## Appendix — what this needs from the API

| Ask | Why | Blocks |
|---|---|---|
| `GET /movies?q=` | Search downloads the whole catalogue to filter it client-side | Part 4 |
| `GET /episodes/:id` | Player still walks the catalogue to find one episode (carried over from `FRONTEND_PLAN.md`) | Not blocking, still true |

## Open questions

1. **Content protection for offline (blocks 5b, not this spec)** — may premium
   episodes be cached unencrypted on-device, accepting that a determined user
   can extract the file? The alternatives are HLS AES-128 with a
   short-lived key served per playback (cheap, defeats casual copying, not a
   real DRM) or a full DRM stack (Widevine/FairPlay — a vendor, a licence
   server, and a different budget). This is a licensing and business call, not
   a technical one, and 5b cannot be designed until it is made.
2. ~~**Downloads**~~ — resolved: both. Rename in Phase 4, offline as its own
   spec (Part 5).
3. ~~**New-user routing**~~ — resolved: both. Plan selection still interrupts a
   first-time verify, and `next` is forwarded through it, so the episode is
   still the destination once a plan is chosen or skipped.

## Assumptions

- Dark-only, as before. `User.theme` still implies light mode eventually; every
  fix here uses semantic tokens, so that stays inexpensive.
- No payment-gateway change. Omise is wired and tested; Part 1 only alters
  where the user lands afterwards.
- No new runtime dependency. Toasts are CSS plus React state.
