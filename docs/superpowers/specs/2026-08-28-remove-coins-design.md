# Removing the coin economy: subscription-only entitlement

> Flick drops its virtual currency entirely and sells one thing: a ฿249/month
> subscription. This is a monetization change wearing the clothes of a
> deletion — coins are currently the *primary* gate on paid content, so
> removing them without care either gives that content away or strands it
> behind a paywall no code path can open.
>
> **Pre-launch.** No real money has moved through coin packs, so there is no
> data migration, no compensation, no backfill, and no reversibility
> ceremony. Columns are dropped outright.
>
> **Baseline:** `integration/unify` @ `3c650d8` — the tree at the end of the
> return-to-intent pass. Verified green: `flick-app` 60 vitest + build + lint;
> `flick-api` 183 jest + 21 e2e + lint.
>
> **Verified against:** Next.js 16.2.12 · NestJS 11 · Prisma 7.9.1 · 28 Aug 2026

---

## Prologue: coins are the paywall, not a side feature

It is tempting to read "remove the coin system" as deleting a wallet page and
a currency pill. It is not. Today the seed ships six paid episodes and **every
one of them is coin-gated**:

| Episode | `isPremium` | `coinCost` | Gate today |
|---|---|---|---|
| `sathu-premium` (สาธุ ep2) | `true` | 10 | `coins_required` |
| ดาวซินโดม ep2 | `false` | 10 | `coins_required` |
| หนีผี ep2 | `false` | 10 | `coins_required` |
| เงา ep2 | `false` | 10 | `coins_required` |
| รัก ep2 | `false` | 10 | `coins_required` |
| ปฏิบัติการเสนา ep2 | `false` | 10 | `coins_required` |

`PlaybackService.authorize` grants free access when
`!episode.isPremium && episode.coinCost === 0` (`playback.service.ts:60`).
Delete the `coinCost` column without touching `isPremium` and that condition
becomes `!episode.isPremium` — which is **true for five of those six
episodes**. The entire paid catalogue except one episode silently becomes
free.

So the first requirement of this work is not a deletion at all: it is
promoting those five episodes to `isPremium: true` **before or with** the
column drop. Everything else follows.

---

## Part 1 — The entitlement model

Three tiers become two. `PlaybackAuthorization` (`playback.service.ts:11-21`)
shrinks on both arms:

```ts
export type PlaybackAuthorization =
  | { allowed: true;  reason: 'free' | 'subscription'; videoUrl: string }
  | { allowed: false; reason: 'subscription_required' };
```

`'unlocked'` goes (nothing can unlock a single episode any more) and the deny
arm loses both `'coins_required'` and the `coinCost` number, because there is
no longer a per-episode price to report.

`authorize` loses its third check and its `WalletService` dependency:

```ts
const episode = await this.prisma.episode.findFirst({
  where: { id: episodeId, ...AVAILABLE_EPISODE_FILTER },
  select: { id: true, videoUrl: true, isPremium: true },   // coinCost gone
});
if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

if (!episode.isPremium) return this.grant('free', episode.videoUrl);
if (await this.subscriptions.hasActiveSubscription(userId)) {
  return this.grant('subscription', episode.videoUrl);
}
return { allowed: false, reason: 'subscription_required' };
```

`isPremium` becomes the single source of truth for "is this content paid?".

---

## Part 2 — Database

One migration, all drops, no preservation:

- **Drop model `UserCoin`** in full (`schema.prisma:305-322`).
- **Drop enum `TransactionType`** (`schema.prisma:31-37`). Verified
  coin-exclusive: its only schema use is `UserCoin.transactionType`, and its
  only code uses are in `wallet.service.ts` and the coin-credit branch of
  `payments.service.ts`, both deleted here.
- **Drop `User.coinBalance`** (`schema.prisma:71`).
- **Drop `Episode.coinCost`** (`schema.prisma:212`).
- `PaymentEvent` loses its `UserCoin` back-relation; `PaymentEvent` itself
  stays — it is the subscription payment record and is unrelated to coins.

Seed (`prisma/seed.ts`): remove every `coinCost` field, and set
`isPremium: true` on the five episodes listed in the Prologue that currently
rely on `coinCost` alone (lines 104, 141, 178, 215, 252). `sathu-premium`
(line 67) already carries `isPremium: true` and only needs its `coinCost`
removed.

---

## Part 3 — Backend

**Deleted outright:** `src/wallet/` — `wallet.controller.ts`,
`wallet.service.ts`, `wallet.module.ts`, `wallet.service.spec.ts`,
`dto/spend-coins.dto.ts`. This removes the `GET /wallet` and
`POST /wallet/spend` endpoints.

**Importers to update:** `app.module.ts:13,29`, `playback.module.ts:5,8`,
`payments.module.ts:11,14` all drop `WalletModule`.

**`payments/catalog.ts`:** `CatalogItemType` narrows to `'SUBSCRIPTION'`. The
`COIN_PACK` resolution branch and the `coins?` field on
`ResolvedCatalogItem` go. `UNKNOWN_PACK` goes with them.

**`payments.service.ts`:** drops the `WalletService` dependency (`:11-12,:32`)
and the coin-credit fulfillment branch (`:286-295`) that called
`wallet.credit(...)` inside the fulfillment transaction. Subscription
fulfillment is untouched.

**`plans/plans.config.ts`:** delete `COIN_PACKS`; see Part 6 for the plan
changes.

**`plans/plans.controller.ts`:** the response drops its `coins` key.

**`auth/jwt.strategy.ts:34`** and **`auth/current-user.decorator.ts:9`** drop
`coinBalance`, so it stops flowing into every authenticated request's user
object.

**`testing/prisma.mock.ts`:** drop the `userCoin` mock block.

**Specs:** delete `wallet.service.spec.ts`; update `playback.service.spec.ts`
(its `coins_required` and coin-unlock cases), `payments.service.spec.ts`,
`catalog.spec.ts`, and the two e2e specs that reference coins/wallet
(`test/payments.e2e-spec.ts`, `test/entitlement.e2e-spec.ts`).

### Breaking response shape

`GET /plans` returns `{ subscriptions, coins }` today and `{ subscriptions }`
after. The client's `decodePlans` validates `plans.coins` as a required array
(`types/api.ts:98`) and will throw on the new shape, so **the controller
change and the `decodePlans` change must land in the same commit.**

---

## Part 4 — The post-checkout grant path

This is the highest-risk edit in the whole change, because it is load-bearing
for the flow verified end-to-end on 28 Aug and it is not obviously coin code.

`features/payments/api.ts` decides "did the thing I just paid for actually
arrive?" by polling. It watches **two** signals — `/subscriptions/me` and
`/wallet` — and `checkGranted` has three branches:

1. `SUBSCRIPTION` → compare subscription `endDate` against a pre-checkout baseline
2. `COIN_PACK` → compare wallet balance against a pre-checkout baseline
3. **`itemType === null`** → watch *both*, capturing whichever baseline is
   missing rather than comparing it

Branch 2 goes. Branch 3 **must survive**, reduced to the subscription half.
It is not coin-specific: it is the recovery path for a user who returns from
the gateway in a different tab, on a different device, with cleared
`sessionStorage`, or by navigating to the processing URL directly. Deleting it
alongside the coin code would break checkout recovery in a way no unit test
currently catches — the e2e suite exercises the happy path where
`sessionStorage` survives.

Also removed: `PendingCheckout.baselineBalance` and the `COIN_PACK` arm of
`rememberPendingCheckout`, which currently does a pre-checkout `GET /wallet`
to capture the balance baseline.

`CheckoutItemType` becomes a single-member union (`'SUBSCRIPTION'`). Keep the
type rather than inlining the string: `checkGranted`'s null-vs-known
distinction still needs to be expressible.

---

## Part 5 — Frontend

### The gate sheet collapses

`PlayerClient.tsx:372-415` is a three-way branch today: coins-insufficient,
coins-sufficient (with the `◆ 100 → ◆ 90` arithmetic), and
subscription-required. Two of the three go. What remains is the
subscription branch built in Task 14 of the return-to-intent pass — the
inline plan comparison — which becomes the **only** gate presentation.

The sheet's title expression (`:372`) simplifies to the constant
`'สมัครสมาชิกเพื่อรับชม'`. `PlayerClient` also drops the `initialBalance`
prop (`:43,:50`), the `balance` state (`:61`), and `unlockWithCoins`
(`:72`); `player/[id]/page.tsx` stops passing `initialBalance={session.coinBalance}`.

`usePlaybackAuthorization.ts:75-95` drops `unlockWithCoins` entirely — it is
the only caller of `POST /wallet/spend`.

### Everything else

| File | Change |
|---|---|
| `types/index.ts` | drop `coinBalance` (:8), `WalletResponse` (:44), `'unlocked'` (:73), `'coins_required'` + `coinCost` (:78-79), `CoinPack` (:156); swap `Episode.coinCost` → `isPremium` (:66) |
| `types/api.ts` | drop `/wallet` + `/wallet/spend` paths, `WalletResponse` mapping, coin-pack decoding (:98-111), `requireNumber(authorization, 'coinCost')` (:140), `/wallet` decode branch (:161-165) |
| `SubscribeClient.tsx` | delete the coin-pack section entirely |
| `subscribe/page.tsx` | drop the `coinPacks` prop and its `decodePlans` coins read |
| `AppHeader.tsx` | drop the `coinBalance` prop (:7,:17) and the balance pill (:33-41) |
| `profile/page.tsx` | drop the coin balance display (:119-120) |
| `home/page.tsx` | drop `coinBalance={session.coinBalance}` (:55) |
| `MovieClient.tsx` | replace the per-episode `ล็อก · N เหรียญ` badge (:209-210) and its `ep.coinCost > 0` dimming (:187) with an `isPremium`-driven lock indicator — see below |
| `DiscoverClient.tsx` | drop the `coins_required` gate branch (:303-304) |
| `Icon.tsx` | drop `'coin'` from `IconName` and the glyph dictionary |
| `Toast.tsx` | reword two comments that cite coin unlocks as the motivating example (:22,:25) |
| `layout.tsx` | reword the `text-data` comment that cites coin balances (:21) |

**`MovieClient` needs replacement, not deletion.** The episode list currently
distinguishes paid episodes only by their coin badge. Delete it and every
episode in the list looks identical, so a user cannot tell what is gated until
they tap it and hit the sheet. The badge becomes a premium marker driven by
`isPremium`.

This is a type-only change, not an API change: `MoviesService.toDto` strips
just `videoUrl`, so `isPremium` is **already in the `/movies` payload** — the
client's `Episode` interface simply never declared it. The edit is a
one-for-one swap in `types/index.ts:56-68`:

```ts
-  coinCost: number;
+  isPremium: boolean;
```

---

## Part 6 — Pricing

`plans.config.ts` after:

```ts
export const PLAN_DURATIONS_MS = {
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;
```

The `weekly` plan object is deleted from `SUBSCRIPTION_PLANS`, and `monthly`
goes **฿149 → ฿249**. The `free` entry stays: it is display-only, priced 0,
and already unpurchasable via `resolveCatalogItem`'s `price <= 0` guard, so
`/subscribe` still shows a ฟรี card beside the ฿249 one.

Narrowing `PaidPlanId` to `'monthly'` turns every lingering `'weekly'` into a
TypeScript error — which is exactly the compile-time guard that type was
introduced for. Known fixtures to update: `catalog.spec.ts`,
`payments.service.spec.ts`, and `test/payments.e2e-spec.ts`, which transact
`SUBSCRIPTION:weekly` at 4900 satangs and become `monthly` at **24900**.

Rationale for dropping weekly: at ฿49/week ≈ ฿211/month it would have
undercut the new ฿249 monthly, making monthly dead inventory.

---

## Part 7 — Two things that must NOT be deleted

A blanket "remove every coin reference" sweep breaks both of these. They are
called out because they read as coin code and are not.

### 1. `--color-coin` is a shared gold accent — rename it, don't drop it

The token (`globals.css:30`) has eleven consumers, and **four have nothing to
do with currency**:

- `HomeClient.tsx:85` — the "แนะนำวันนี้" section label
- `LandingClient.tsx:92` — a poster badge
- `DiscoverClient.tsx:301` — a filled-bookmark icon
- `SubscribeClient.tsx:91` — the `คุ้มที่สุด` plan badge, which **survives on
  the ฿249 card**

Rename the token to something honest about its role (`--color-gold` is the
obvious candidate), repoint those four plus the surviving plan badge, and drop
only the genuinely coin-bound uses. The explanatory comment at
`globals.css:24-26`, which contrasts brand-orange against "the coin economy",
gets rewritten at the same time.

### 2. `'flick_coins'` stays in `legacyStorage.ts`

`LEGACY_KEYS` (`legacyStorage.ts:5-13`) is a **purge list**, not a feature. It
names stale `localStorage` keys written by the pre-server auth layer and
removes them on login. Any device that used that build still holds
`flick_coins`; taking it out of the list orphans that key on those devices
permanently. It costs one array entry to keep and it is the only thing that
ever cleans it up.

---

## Verification

Per-task TDD, both suites green throughout. Two checks beyond the unit level:

1. **Entitlement regression.** After the seed change, every episode that was
   coin-gated must return `subscription_required` — not `free`. This is the
   Prologue's failure mode and deserves an explicit e2e assertion rather than
   trust in the migration.
2. **Re-run the Task 15 manual funnel.** The gate sheet (Part 5) and the
   checkout-return path (Part 4) both change, and that walkthrough is what
   covers them: logged-out deep link → `?next=` → OTP → land on the episode;
   gate → `/subscribe?next=` → checkout → processing screen returns to the
   episode; `next=https://evil.com` and `next=//evil.com` both land on `/home`.

---

## Not in this spec

- **Reviving per-episode pricing.** `Episode.coinCost` is dropped, not kept
  dormant. Re-adding it later is a new migration.
- **Promotional / trial pricing.** `PLAN_DURATIONS_MS` keeps its two-key shape
  minus one key; no trial tier is introduced.
- **Auto-renew.** Still absent, still out of scope — renewal-before-expiry
  remains the flow `checkGranted` compares `endDate` against.
