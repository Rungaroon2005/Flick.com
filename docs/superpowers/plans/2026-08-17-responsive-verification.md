# Responsive Layout: Final Verification Record

> Task 13 of `docs/superpowers/plans/2026-08-17-responsive-layout.md`. Verified against a
> real running dev server for this worktree (port 3110, backed by the real API on 3001
> with seeded data), not a mock or a build-only check.

**Verification method note.** `mcp__claude-in-chrome__resize_window` was confirmed
non-functional in this environment — it reports success but the browser window stays
stuck near 800×600 regardless of the requested size (the same failure that derailed an
earlier task's first attempt). Worked around it with a same-page iframe harness: inject
an `<iframe>` sized to the exact target width/height and read its `contentDocument`/
`contentWindow` directly. This gives an accurate per-breakpoint viewport independent of
the outer browser window, and was used for every JS-assertion check below. A handful of
checks were also done via direct navigation in a normal tab for real screenshots.

## Per-page assertion sweep

All 12 screens × 390/834/1194/1440px, checked via the iframe harness:
- `horizontalOverflow` — `document.documentElement.scrollWidth > viewport width`
- `navCount`/kind — which nav (bottom pill vs. top bar) is actually visible, not just
  present in the DOM (both share the same `aria-label`, so a naive count can't
  distinguish them — checked by class/DOM position instead)
- Grid column counts on `/search` and `/bookmarks`

**Result: zero horizontal overflow on any of the 48 screen×width combinations.**

Nav regime, checked explicitly by kind (not just count) on the six `(app)` tab routes:

| Width | home | discover | search | bookmarks | downloads | profile |
|---|---|---|---|---|---|---|
| 390 | PILL | PILL | PILL | PILL | PILL | PILL |
| 834 | PILL | PILL | PILL | PILL | PILL | PILL |
| 1194 | BAR | BAR* | BAR | BAR | BAR | BAR |
| 1440 | BAR | BAR* | BAR | BAR | BAR | BAR |

\* `/discover` initially showed **neither** nav at 1194/1440 — see Defect Found below.
Fixed; now shows BAR correctly.

Non-tab routes (`/`, `/login`, `/register`, `/movie/[id]`, `/player/[id]`, `/subscribe`)
correctly show zero nav at every width, as designed.

Search grid columns: 390→3, 1194→5, 1440→6 (matches the `grid-cols-3 md:grid-cols-4
lg:grid-cols-5 xl:grid-cols-6` ladder exactly).

## Defect found and fixed during this sweep

**`/discover` had zero navigation at desktop widths (1194, 1440).** Task 2's `lg:hidden`
on `BottomNav` assumed `AppHeader`'s `HeaderNav` would always be the replacement — true
for five of six tab routes, false for `/discover`, which never rendered `AppHeader` (its
own chrome is a minimal filter-trigger button). Fixed by reusing `AppHeader`'s existing
`overlay` variant (already used by `HomeClient`'s hero for exactly this over-video case)
in a `lg:`-only block, with the filter trigger pushed down via `lg:top-16` to clear it.
Commit `f7b7249`, reviewed and approved (spec ✅, zero Critical/Important findings — see
ledger for the full fix dispatch and review).

## Visual spot-checks (real browser, direct navigation)

- **`/home` at 1440px** — top nav bar sticky through scroll, side-by-side hero, 5 cards
  per shelf row, images sharp (not upscaled/blurry), continue-watching progress bars
  intact. Resolves the visual check deferred by Task 6 (its brief's Step 5 browser pass
  was skipped there in favor of string-comparison verification).
- **`/player` chrome-hugs-stage** — confirmed the title bar and scrub bar now align to
  the pillarboxed video stage rather than spanning the full viewport, with the reaction
  rail correctly in the right pillar outside the stage. Resolves the action item from
  Task 11's ruling (chrome-tracks-stage behavior extending to iPad-portrait geometry,
  not just `lg`+, was accepted as a bonus fix rather than reverted — see ledger).
- **`/discover` at 1194px** — top nav bar renders correctly over the video feed with the
  overlay gradient, filter trigger correctly pushed below it, reaction rail unaffected.

**Not obtained:** a real-browser screenshot of the landing page's coverflow-card overlap
at 1194px (Task 9's flagged thin-margin check) — the landing page (`/`) redirects to
`/home` for any authenticated session, and the only session available in this
environment was the seeded E2E test user. This check instead rests on three independent
arithmetic derivations (implementer, controller, reviewer — all in Task 9's ledger
entries) that converged on the same ~166px threshold and confirmed the shipped 170px
value clears it with a ~3.7px margin at the binding `lg` case. Recommend an unauthenticated
visual pass before the branch ships, if convenient.

## Build and budget gates

```
npm run build            → success, all 12 routes generated
npm run performance:check →
  PASS largest JavaScript chunk: 573,993 bytes (budget 640,000)
  PASS total emitted JavaScript: 1,534,929 bytes (budget 1,700,000)
  PASS total emitted CSS: 70,740 bytes (budget 80,000)
  PASS largest source poster: 1,053,843 bytes (budget 1,100,000)
  PASS playback-only media policy
npm run lint              → clean
npm test                  → 9 files, 18 tests, all passing
```

CSS budget: started this plan at 67,694 bytes (12,306 headroom), ended at 70,740 bytes
(9,260 headroom) — the whole 13-task responsive pass added ~3,046 bytes of CSS, well
inside budget. No need for the `@utility page-gutter` consolidation the plan named as a
fallback.

## Safe-area

`viewport-fit=cover` confirmed present in the viewport meta tag, unchanged by this plan
— `env(safe-area-inset-*)` continues to resolve correctly.

## Not covered in this pass

- 1920px spot-check (large desktop) — the `xl`/`2xl` regime is identical by design (the
  container stops growing at `xl`), so this was deprioritized in favor of the defect
  investigation and fix above. Low risk given `2xl` introduces no new classes anywhere
  in this plan's diffs.
- Landing-page coverflow visual confirmation (see above — blocked by session auth, not
  by time).
- Interaction/gesture testing beyond static layout (snap-scroll advancing, swipe-to-open,
  player auto-hide timing) — these were verified structurally in each task's own review
  (JS logic diffs confirmed untouched) rather than re-tested end-to-end here, since this
  plan's changes are presentation-only and never touched the relevant event handlers.
