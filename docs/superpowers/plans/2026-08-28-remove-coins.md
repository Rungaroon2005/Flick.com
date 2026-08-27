# Remove the Coin Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the coin/wallet system entirely and move to subscription-only
entitlement at ฿249/month, with no data migration (pre-launch, no real money
moved).

**Architecture:** Two-tier entitlement (free / subscription) replaces the
current three-tier one (free / subscription / coin-unlock).
`Episode.isPremium` becomes the sole gate; `Episode.coinCost` and the entire
`UserCoin` ledger are dropped in one migration. The API contract
(`PlaybackAuthorization`, `GET /plans`) changes shape, so backend and
frontend land together in one task rather than sequential API-then-client
tasks. Pricing drops the weekly plan and raises monthly ฿149 → ฿249.

**Tech Stack:** NestJS 11, Prisma 7.9.1, PostgreSQL, Next.js 16.2.12, Vitest,
Jest, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-28-remove-coins-design.md`

## Global Constraints

- Pre-launch: no data migration, no compensation logic, no backfill. Every
  coin-related column is dropped outright.
- Every episode currently gated by `coinCost: 10` (with `isPremium: false`)
  must become `isPremium: true` in the same commit as the column drop — see
  spec Prologue. Only `sathu-premium` already has `isPremium: true`.
- The `--color-coin` CSS token is renamed to `--color-gold`, not deleted —
  four of its consumers are unrelated gold accents that survive this change
  (see spec Part 7).
- `'flick_coins'` stays in `legacyStorage.ts`'s `LEGACY_KEYS` purge list — it
  is not feature code, it is what cleans up a stale key on devices that ran
  the pre-server auth layer.
- Monthly subscription price: **฿249** (24900 satangs). Weekly plan is
  deleted entirely, not repriced.
- Every task ends with its own suite green (`npm test`, `npm run lint`, and
  `npm run build` for `flick-app`; `npm test`, `npm run lint` for
  `flick-api`) before moving to the next task.

---

## Task 1: Database schema — drop the coin ledger

**Files:**
- Modify: `apps/flick-api/prisma/schema.prisma`
- Modify: `apps/flick-api/prisma/seed.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the Prisma Client types every later backend task compiles
  against — `Episode` with no `coinCost`, `User` with no `coinBalance`, no
  `UserCoin` model, no `TransactionType` enum.

**Context:** This is the prerequisite the whole plan hangs on. `PUBLISHED`
episodes gated only by `coinCost: 10` (with `isPremium: false`) become free
the instant the column disappears unless `isPremium` is set first — see the
spec's Prologue table. This task does both in one migration so that state
never exists.

- [ ] **Step 1: Edit the schema**

In `apps/flick-api/prisma/schema.prisma`:

Delete the `TransactionType` enum (lines 31-37):

```prisma
enum TransactionType {
  EARNED
  PURCHASED
  SPENT
  REFUNDED
  EXPIRED
}
```

In `model User`, delete the `coinBalance` field and its comment (line 70-71):

```prisma
  // Cache for UI speed, but derived from UserCoin ledger
  coinBalance Int @default(0)
```

In `model User`, delete the `userCoins` relation (part of the relations
block):

```prisma
  userCoins      UserCoin[]
```

In `model Episode`, delete `coinCost` (line 212):

```prisma
  coinCost        Int     @default(0)
```

In `model PaymentEvent`, delete the `userCoins` back-relation:

```prisma
  userCoins UserCoin[]
```

Delete `model UserCoin` in full:

```prisma
model UserCoin {
  id              String          @id @default(uuid())
  userId          String
  paymentEventId  String?
  transactionType TransactionType
  amount          Int // Positive for gain, negative for spend
  balanceAfter    Int // Running balance for quick audits
  description     String

  createdAt DateTime @default(now())

  user         User          @relation(fields: [userId], references: [id], onDelete: Restrict)
  paymentEvent PaymentEvent? @relation(fields: [paymentEventId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@map("user_coins")
}
```

- [ ] **Step 2: Update the seed**

In `apps/flick-api/prisma/seed.ts`, promote every coin-gated episode to
`isPremium: true` and drop `coinCost` from every episode object. There are
seven episode literals with a `coinCost` field; six become `isPremium: true`
(the ones with `coinCost: 10`), one (episode 1 of each movie) drops
`coinCost: 0` with no `isPremium` change since it stays free.

Change this line (episode 2 of "สาธุ" — already `isPremium: true`, just
drop `coinCost`):

```ts
{ id: 'sathu-premium', episodeNumber: 2, title: 'อยู่อย่างง่าย', description: 'ตอนที่ 2', durationMinutes: 10, thumbnailUrl: '/posters/sathu.jpg', videoUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', isPremium: true, coinCost: 10, releaseDate: new Date() },
```

to:

```ts
{ id: 'sathu-premium', episodeNumber: 2, title: 'อยู่อย่างง่าย', description: 'ตอนที่ 2', durationMinutes: 10, thumbnailUrl: '/posters/sathu.jpg', videoUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', isPremium: true, releaseDate: new Date() },
```

Change these five lines (episode 2 of ดาวซินโดม, หนีผี, เงา, รัก,
ปฏิบัติการเสนา — currently `coinCost: 10` with no `isPremium`):

```ts
{ episodeNumber: 2, title: 'ดาวตก', description: 'ตอนที่ 2', durationMinutes: 14, thumbnailUrl: '/posters/dao.jpg', coinCost: 10, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'เสียงเรียก', description: 'ตอนที่ 2', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', coinCost: 10, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'ผู้ต้องสงสัย', description: 'ตอนที่ 2', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', coinCost: 10, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'สัญญาใจ', description: 'ตอนที่ 2', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', coinCost: 10, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'ภารกิจสุดท้าย', description: 'ตอนที่ 2', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', coinCost: 10, releaseDate: new Date() },
```

to (each drops `coinCost: 10`, adds `isPremium: true`):

```ts
{ episodeNumber: 2, title: 'ดาวตก', description: 'ตอนที่ 2', durationMinutes: 14, thumbnailUrl: '/posters/dao.jpg', isPremium: true, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'เสียงเรียก', description: 'ตอนที่ 2', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', isPremium: true, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'ผู้ต้องสงสัย', description: 'ตอนที่ 2', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', isPremium: true, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'สัญญาใจ', description: 'ตอนที่ 2', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', isPremium: true, releaseDate: new Date() },
```
```ts
{ episodeNumber: 2, title: 'ภารกิจสุดท้าย', description: 'ตอนที่ 2', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', isPremium: true, releaseDate: new Date() },
```

Drop `coinCost: 0` from the six episode-1 literals (they stay free either
way, this just removes the now-nonexistent field):

```ts
{ episodeNumber: 1, title: 'อยู่อย่างยาก', description: 'คลิปตัวอย่างจาก movie1.MOV', durationMinutes: 1, thumbnailUrl: '/posters/sathu.jpg', videoUrl: '/videos/movie1-preview.m4v', coinCost: 0, releaseDate: new Date() },
```
```ts
{ episodeNumber: 1, title: 'เพื่อนไม่คบ', description: 'คลิปตัวอย่างจาก movie2.MOV', durationMinutes: 1, thumbnailUrl: '/posters/dao.jpg', videoUrl: '/videos/movie2-preview.m4v', coinCost: 0, releaseDate: new Date() },
```
```ts
{ episodeNumber: 1, title: 'คืนแรก', description: 'ตอนที่ 1', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', coinCost: 0, releaseDate: new Date() },
```
```ts
{ episodeNumber: 1, title: 'ร่องรอย', description: 'ตอนที่ 1', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', coinCost: 0, releaseDate: new Date() },
```
```ts
{ episodeNumber: 1, title: 'พบกันครั้งแรก', description: 'ตอนที่ 1', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', coinCost: 0, releaseDate: new Date() },
```
```ts
{ episodeNumber: 1, title: 'บุกเดี่ยว', description: 'ตอนที่ 1', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', coinCost: 0, releaseDate: new Date() },
```

become the same lines with `coinCost: 0,` removed (e.g. the first becomes
`{ episodeNumber: 1, title: 'อยู่อย่างยาก', description: 'คลิปตัวอย่างจาก movie1.MOV', durationMinutes: 1, thumbnailUrl: '/posters/sathu.jpg', videoUrl: '/videos/movie1-preview.m4v', releaseDate: new Date() },`
— apply the same removal to the other five).

- [ ] **Step 2: Generate and apply the migration**

Run: `cd apps/flick-api && npx prisma migrate dev --name remove_coin_economy`

Expected: Prisma detects the dropped enum, dropped columns, and dropped
`UserCoin`/`user_coins` table, generates a migration with `DROP TABLE
"user_coins"`, `ALTER TABLE "users" DROP COLUMN "coinBalance"`, `ALTER TABLE
"episodes" DROP COLUMN "coinCost"`, `DROP TYPE "TransactionType"`, applies it
cleanly, and regenerates the Prisma Client.

- [ ] **Step 3: Re-seed**

Run: `cd apps/flick-api && npm run db:seed`

Expected: `Database seeded successfully!` with no errors. This confirms the
seed file compiles against the new Prisma Client types (no `coinCost`
anywhere, `isPremium: true` on the six episodes above).

- [ ] **Step 4: Commit**

```bash
git add apps/flick-api/prisma
git commit -m "feat(api): drop the coin ledger from the schema

Episode.coinCost, User.coinBalance, UserCoin, and TransactionType are
gone. Every episode that relied on coinCost alone (isPremium false)
is promoted to isPremium true in the same commit as the column drop,
so no paid episode is ever free between these two changes."
```

---

## Task 2: Backend — collapse entitlement to two tiers

**Files:**
- Modify: `apps/flick-api/src/playback/playback.service.ts`
- Modify: `apps/flick-api/src/playback/playback.service.spec.ts`
- Modify: `apps/flick-api/src/engagement/engagement.service.ts:185-186` (comment only)

**Interfaces:**
- Consumes: `Episode.isPremium` (Task 1), `SubscriptionsService.hasActiveSubscription`.
- Produces: `PlaybackAuthorization` narrowed to
  `{ allowed: true; reason: 'free' | 'subscription'; videoUrl: string } | { allowed: false; reason: 'subscription_required' }`.
  Task 3's frontend work and every other backend task that touches this type
  read this new shape.

**Context:** This is the type every consumer downstream reads. `authorize`
loses its third (wallet) check entirely — no `WalletService` dependency
survives in this file.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/flick-api/src/playback/playback.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let subscriptions: { hasActiveSubscription: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    subscriptions = { hasActiveSubscription: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
  });

  it('allows a free episode without touching subscription', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: false,
    });
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: true,
      reason: 'free',
      videoUrl: 'u',
    });
    expect(subscriptions.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('never leaks videoUrl when access is denied', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'SECRET',
      isPremium: true,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    const result = await service.authorize('u1', 'e1');
    expect(result.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('lets an active subscriber watch a premium episode', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(true);
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: true,
      reason: 'subscription',
      videoUrl: 'u',
    });
  });

  it('denies with subscription_required when the episode is premium and not subscribed', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: false,
      reason: 'subscription_required',
    });
  });

  it('throws NotFoundException when the episode does not exist', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.authorize('u1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('requires the episode to belong to a published, non-deleted movie', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.authorize('u1', 'hidden')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'hidden',
          deletedAt: null,
          season: {
            movie: { status: 'PUBLISHED', deletedAt: null },
          },
        },
      }),
    );
  });

  it('throws ServiceUnavailableException when access is allowed but videoUrl is null', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: null,
      isPremium: false,
    });
    await expect(service.authorize('u1', 'e1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/flick-api && npm test -- playback.service`
Expected: FAIL — `PlaybackService` still selects `coinCost`, still injects
`WalletService`, and `authorize`'s return shape still includes `coinCost`
and the `'unlocked'`/`'coins_required'` reasons the new assertions don't
match.

- [ ] **Step 3: Rewrite the service**

Replace the full contents of `apps/flick-api/src/playback/playback.service.ts`:

```ts
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AVAILABLE_EPISODE_FILTER } from '../common/content-availability';

export type PlaybackAuthorization =
  | {
      allowed: true;
      reason: 'free' | 'subscription';
      videoUrl: string;
    }
  | {
      allowed: false;
      reason: 'subscription_required';
    };

/**
 * The single place that answers "may this user watch this episode?". This
 * is the ONLY server-side path through which a real `videoUrl` is ever
 * returned to a client — `MoviesService.toDto` strips `videoUrl` from every
 * other response (see movies.service.ts) so entitlement can never be
 * bypassed by reading it off `/movies` instead.
 */
@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Resolves entitlement in a fixed precedence, cheapest check first, and
   * short-circuits as soon as one check grants access:
   *   1. free (no DB/service calls beyond the episode lookup itself)
   *   2. active subscription
   *
   * No caching here on purpose — entitlement changes the instant a
   * subscription lapses; a stale cache would grant or deny wrongly.
   */
  async authorize(
    userId: string,
    episodeId: string,
  ): Promise<PlaybackAuthorization> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...AVAILABLE_EPISODE_FILTER },
      select: { id: true, videoUrl: true, isPremium: true },
    });
    if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

    if (!episode.isPremium) {
      return this.grant('free', episode.videoUrl);
    }
    if (await this.subscriptions.hasActiveSubscription(userId)) {
      return this.grant('subscription', episode.videoUrl);
    }
    return { allowed: false, reason: 'subscription_required' };
  }

  /**
   * `videoUrl` is nullable in the schema. An "allowed" result with no URL
   * to actually play is a contract violation, not a valid state to return
   * — surface it as a 503 rather than leaking a `null` the caller would
   * have to special-case.
   */
  private grant(
    reason: 'free' | 'subscription',
    videoUrl: string | null,
  ): PlaybackAuthorization {
    if (videoUrl === null) {
      throw new ServiceUnavailableException('ตอนนี้ยังไม่พร้อมรับชม');
    }
    // TODO: issue a short-lived signed URL
    return { allowed: true, reason, videoUrl };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/flick-api && npm test -- playback.service`
Expected: PASS — 7 tests.

- [ ] **Step 5: Reword the engagement service comment**

In `apps/flick-api/src/engagement/engagement.service.ts`, the comment above
`addDownload` reads:

```ts
    // Entitlement-checked via the same authorization path playback uses —
    // otherwise downloads become a side door around coin/subscription
    // gating.
```

Change to:

```ts
    // Entitlement-checked via the same authorization path playback uses —
    // otherwise downloads become a side door around subscription gating.
```

- [ ] **Step 6: Full verification**

Run: `cd apps/flick-api && npm test && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/src/playback apps/flick-api/src/engagement
git commit -m "feat(api): collapse playback entitlement to two tiers

PlaybackAuthorization drops the 'unlocked' allow-reason and the
'coins_required' deny-reason plus its coinCost payload. authorize()
no longer depends on WalletService — isPremium plus an active
subscription is the whole rule now."
```

---

## Task 3: Backend — delete the wallet module

**Files:**
- Delete: `apps/flick-api/src/wallet/wallet.controller.ts`
- Delete: `apps/flick-api/src/wallet/wallet.service.ts`
- Delete: `apps/flick-api/src/wallet/wallet.module.ts`
- Delete: `apps/flick-api/src/wallet/wallet.service.spec.ts`
- Delete: `apps/flick-api/src/wallet/dto/spend-coins.dto.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Modify: `apps/flick-api/src/playback/playback.module.ts`
- Modify: `apps/flick-api/src/payments/payments.module.ts`
- Modify: `apps/flick-api/src/auth/jwt.strategy.ts`
- Modify: `apps/flick-api/src/auth/current-user.decorator.ts`
- Modify: `apps/flick-api/src/testing/prisma.mock.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AuthenticatedUser` with no `coinBalance` field. Every controller
  using `@CurrentUser()` already only reads `.id` from it (verified — no
  other file destructures `.coinBalance`), so this is safe project-wide.

**Context:** `GET /wallet` and `POST /wallet/spend` are removed entirely.
Task 2 already removed `PlaybackService`'s dependency on this module; this
task removes the module itself and its two other importers.

- [ ] **Step 1: Delete the wallet module files**

```bash
rm -rf apps/flick-api/src/wallet
```

- [ ] **Step 2: Remove WalletModule from app.module.ts**

In `apps/flick-api/src/app.module.ts`, delete the import:

```ts
import { WalletModule } from './wallet/wallet.module';
```

and delete `WalletModule,` from the `imports` array.

- [ ] **Step 3: Remove WalletModule from playback.module.ts**

Replace the full contents of `apps/flick-api/src/playback/playback.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PlaybackController } from './playback.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
```

- [ ] **Step 4: Remove WalletModule from payments.module.ts**

In `apps/flick-api/src/payments/payments.module.ts`, delete the import:

```ts
import { WalletModule } from '../wallet/wallet.module';
```

and remove `WalletModule` from `imports: [ConfigModule, WalletModule]`,
leaving `imports: [ConfigModule]`.

- [ ] **Step 5: Drop coinBalance from AuthenticatedUser**

In `apps/flick-api/src/auth/current-user.decorator.ts`, remove the
`coinBalance: number;` line from the `AuthenticatedUser` interface.

In `apps/flick-api/src/auth/jwt.strategy.ts`, remove
`coinBalance: user.coinBalance,` from the object `validate()` returns.

- [ ] **Step 6: Drop the userCoin mock**

In `apps/flick-api/src/testing/prisma.mock.ts`, remove the `userCoin` field
from the `PrismaMock` interface:

```ts
  userCoin: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
```

and remove the corresponding block from `createPrismaMock()`:

```ts
    userCoin: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
```

- [ ] **Step 7: Full verification**

Run: `cd apps/flick-api && npm test && npm run lint && npm run build`
Expected: all green. The build step is the important check here — it
catches any remaining import of `wallet/wallet.service` or
`wallet/wallet.module` that a plain test run would miss if nothing
currently exercises that import path.

- [ ] **Step 8: Commit**

```bash
git add -A apps/flick-api/src
git commit -m "feat(api): delete the wallet module

GET /wallet and POST /wallet/spend are gone. WalletModule is removed
from app.module, playback.module, and payments.module.
AuthenticatedUser drops coinBalance — no other consumer read that
field beyond the two removed here."
```

---

## Task 4: Backend — subscription-only catalog and pricing

**Files:**
- Modify: `apps/flick-api/src/plans/plans.config.ts`
- Modify: `apps/flick-api/src/plans/plans.controller.ts`
- Modify: `apps/flick-api/src/payments/catalog.ts`
- Modify: `apps/flick-api/src/payments/catalog.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PLAN_DURATIONS_MS` narrowed to `{ monthly: number }` (so
  `PaidPlanId` is `'monthly'` only — a compile-time guard against any
  lingering `'weekly'` reference). `CatalogItemType` narrowed to
  `'SUBSCRIPTION'`. `GET /plans` response shape becomes
  `{ subscriptions: SubscriptionPlan[] }` — no `coins` key. Task 5 (frontend
  types) and Task 6 (frontend UI) consume this new shape.

**Context:** Weekly (฿49) undercuts a ฿249 monthly on a per-month basis, so
it is deleted rather than kept. The `free` plan entry stays — it is
display-only and already unpurchasable via the `price <= 0` guard below.

- [ ] **Step 1: Update plans.config.ts**

Replace the full contents of `apps/flick-api/src/plans/plans.config.ts`:

```ts
// Subscription plan configuration
// Extracted from plans.controller.ts to allow updates without code changes

/**
 * Single source of truth for valid paid plan ids and their durations.
 *
 * This is what closes the revenue bug in the legacy frontend flow: the old
 * client-side code sent `'vip-weekly'` while its OWN duration map was keyed
 * `weekly`/`monthly`/`trial`, so the lookup silently fell through to
 * `durations.monthly` — ฿49 bought 30 days instead of 7. By deriving
 * `PaidPlanId` from this object's keys, any caller that passes a plan id
 * not present here is a compile-time type error in TypeScript callers. These
 * durations are reserved for the future verified payment callback; browser
 * activation remains disabled until that integration exists.
 */
export const PLAN_DURATIONS_MS = {
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export type PaidPlanId = keyof typeof PLAN_DURATIONS_MS;

export const SUBSCRIPTION_PLANS = [
  {
    id: 'free',
    name: 'ฟรี',
    nameEn: 'Free',
    price: 0,
    period: '',
    features: ['ดูตอนที่ 1-10 ฟรี', 'คุณภาพ 720p', 'มีโฆษณา', '1 อุปกรณ์'],
    featuresEn: [
      'Episodes 1-10 free',
      '720p quality',
      'Ad-supported',
      '1 device',
    ],
    badge: null,
    color: '#666',
  },
  {
    id: 'monthly',
    name: 'VIP รายเดือน',
    nameEn: 'Monthly VIP',
    price: 249,
    period: '/เดือน',
    features: [
      'ไม่มีโฆษณา',
      'คุณภาพ 1080p/4K',
      'ดูทุกตอน',
      '4 อุปกรณ์',
      'ดาวน์โหลดได้',
      'ดูก่อนใคร',
    ],
    featuresEn: [
      'Ad-free',
      '1080p/4K quality',
      'All episodes',
      '4 devices',
      'Offline download',
      'Early access',
    ],
    badge: 'คุ้มที่สุด',
    color: '#FFD700',
  },
];
```

- [ ] **Step 2: Update plans.controller.ts**

Replace the full contents of `apps/flick-api/src/plans/plans.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { SUBSCRIPTION_PLANS } from './plans.config';
import { Public } from '../auth/public.decorator';

@Controller('plans')
export class PlansController {
  @Public()
  @Get()
  getPlans() {
    return {
      subscriptions: SUBSCRIPTION_PLANS,
    };
  }
}
```

- [ ] **Step 3: Write the failing catalog test changes**

Replace the full contents of `apps/flick-api/src/payments/catalog.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { resolveCatalogItem } from './catalog';
import { PLAN_DURATIONS_MS, SUBSCRIPTION_PLANS } from '../plans/plans.config';

describe('resolveCatalogItem', () => {
  it('prices the monthly plan in satangs, with its own duration', () => {
    const item = resolveCatalogItem('SUBSCRIPTION', 'monthly');
    expect(item.amountSatangs).toBe(24900); // ฿249
    expect(item.durationMs).toBe(PLAN_DURATIONS_MS.monthly);
  });

  it('resolves every paid plan in the config', () => {
    for (const id of Object.keys(PLAN_DURATIONS_MS)) {
      expect(() => resolveCatalogItem('SUBSCRIPTION', id)).not.toThrow();
    }
  });

  it('rejects the free plan — there is nothing to charge for', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'free')).toThrow(
      BadRequestException,
    );
  });

  it('rejects the legacy client id that caused the ฿49-for-30-days bug', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'vip-weekly')).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown ids', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'nope')).toThrow(
      BadRequestException,
    );
  });

  it('rejects prototype-pollution style ids', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'constructor')).toThrow(
      BadRequestException,
    );
    expect(() => resolveCatalogItem('SUBSCRIPTION', '__proto__')).toThrow(
      BadRequestException,
    );
  });

  it('never produces a fractional amount', () => {
    for (const plan of SUBSCRIPTION_PLANS.filter((p) => p.price > 0)) {
      const item = resolveCatalogItem('SUBSCRIPTION', plan.id);
      expect(Number.isInteger(item.amountSatangs)).toBe(true);
    }
  });
});

describe('resolveCatalogItem — prototype-pollution guard', () => {
  it('rejects an item id that only exists as an inherited Object.prototype property', () => {
    jest.isolateModules(() => {
      jest.doMock('../plans/plans.config', () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const actual = jest.requireActual('../plans/plans.config');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return {
          ...actual,
          // A plan whose id collides with an Object.prototype method name.
          // PLAN_DURATIONS_MS deliberately has NO 'toString' key — only
          // monthly — so a naive `itemId in PLAN_DURATIONS_MS` check would
          // still see 'toString' as present (inherited from
          // Object.prototype), fall through, find this plan below, and
          // incorrectly resolve it.
          SUBSCRIPTION_PLANS: [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            ...actual.SUBSCRIPTION_PLANS,
            {
              id: 'toString',
              name: 'Fake',
              nameEn: 'Fake',
              price: 99,
              period: '',
              features: [],
              featuresEn: [],
              badge: null,
              color: '#000',
            },
          ],
        };
      });

      // Re-require AFTER mocking, inside isolateModules, so this fresh
      // module instance sees the mocked config while the file's top-level
      // resolveCatalogItem (used by every other test in this file) is
      // completely unaffected.
      const { resolveCatalogItem: isolatedResolve } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./catalog') as typeof import('./catalog');

      expect(() => isolatedResolve('SUBSCRIPTION', 'toString')).toThrow();
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/flick-api && npm test -- catalog.spec`
Expected: FAIL — `catalog.ts` still imports `COIN_PACKS`, and
`CatalogItemType` still includes `'COIN_PACK'`, so the file does not yet
compile against this narrowed test file's expectations (jest reports a
TypeScript error from `resolveCatalogItem`'s signature, or the removed
`COIN_PACKS` import breaks the build first — either way, a real failure, not
a false pass).

- [ ] **Step 5: Update catalog.ts**

Replace the full contents of `apps/flick-api/src/payments/catalog.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import {
  PLAN_DURATIONS_MS,
  SUBSCRIPTION_PLANS,
  type PaidPlanId,
} from '../plans/plans.config';

export type CatalogItemType = 'SUBSCRIPTION';

export interface ResolvedCatalogItem {
  itemType: CatalogItemType;
  itemId: string;
  /** Smallest currency unit. Never a float, never client-supplied. */
  amountSatangs: number;
  description: string;
  durationMs: number;
}

/** plans.config.ts stores baht; the ledger stores satangs. */
const SATANGS_PER_BAHT = 100;

const UNKNOWN_PLAN = 'ไม่พบแพ็กเกจนี้ (Unknown plan)';

/**
 * Turns a client-supplied item identifier into a server-owned price. The
 * client never sends an amount, so there is nothing to validate against —
 * only an id to look up, and an exception if it is not in the catalog.
 */
export function resolveCatalogItem(
  itemType: CatalogItemType,
  itemId: string,
): ResolvedCatalogItem {
  // hasOwnProperty, not `in` or a bare index: `PLAN_DURATIONS_MS['constructor']`
  // is truthy via the prototype chain and would resolve a plan that does
  // not exist.
  if (!Object.prototype.hasOwnProperty.call(PLAN_DURATIONS_MS, itemId)) {
    throw new BadRequestException(UNKNOWN_PLAN);
  }
  const plan = SUBSCRIPTION_PLANS.find((candidate) => candidate.id === itemId);
  // A plan present in PLAN_DURATIONS_MS but priced at 0 (or missing from the
  // display list) is not purchasable.
  if (!plan || plan.price <= 0) throw new BadRequestException(UNKNOWN_PLAN);

  return {
    itemType,
    itemId,
    amountSatangs: plan.price * SATANGS_PER_BAHT,
    description: `Flick ${plan.nameEn}`,
    durationMs: PLAN_DURATIONS_MS[itemId as PaidPlanId],
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/flick-api && npm test -- catalog.spec`
Expected: PASS — 6 tests plus the prototype-pollution guard describe block.

- [ ] **Step 7: Full verification**

Run: `cd apps/flick-api && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/flick-api/src/plans apps/flick-api/src/payments/catalog.ts apps/flick-api/src/payments/catalog.spec.ts
git commit -m "feat(api): subscription-only catalog at 249/month

Weekly plan deleted (at 49/week it would have undercut a 249 monthly
per-month). Monthly raised 149 -> 249. CatalogItemType narrows to
'SUBSCRIPTION' and ResolvedCatalogItem drops the coins field. GET
/plans response drops its coins key."
```

---

## Task 5: Backend — payments service drops coin fulfillment

**Files:**
- Modify: `apps/flick-api/src/payments/payments.service.ts`
- Modify: `apps/flick-api/src/payments/payments.service.spec.ts`

**Interfaces:**
- Consumes: `resolveCatalogItem` (Task 4, now subscription-only).
- Produces: `PaymentsService` with no `WalletService` dependency.
  `grantEntitlement` unconditionally creates a subscription — no branching.

**Context:** `grantEntitlement`'s `if (item.itemType === 'SUBSCRIPTION')`
branch becomes the entire method body once `COIN_PACK` no longer exists as a
possible `item.itemType`.

- [ ] **Step 1: Update the failing test fixtures first**

In `apps/flick-api/src/payments/payments.service.spec.ts`:

Remove the import:
```ts
import { WalletService } from '../wallet/wallet.service';
```

Change the `@prisma/client` import from:
```ts
import { Prisma, TransactionType } from '@prisma/client';
```
to:
```ts
import { Prisma } from '@prisma/client';
```

In the `PaymentsService.createCheckout` describe block, remove the line
```ts
        { provide: WalletService, useValue: { credit: jest.fn() } },
```
from the `TestingModule` providers array.

Change both occurrences of `itemId: 'weekly'` in this describe block (the
"stores the server-resolved price" test and the "records a charge id" test)
to `itemId: 'monthly'`.

In the `PaymentsService.handleWebhook` describe block:

Remove the `let wallet: { credit: jest.Mock };` declaration.

Remove `wallet = { credit: jest.fn().mockResolvedValue(100) };` from
`beforeEach`.

Remove
```ts
        { provide: WalletService, useValue: wallet },
```
from that describe block's `TestingModule` providers array.

Change the `pendingIntent` helper's defaults from
```ts
    itemId: 'weekly',
    amountSatangs: 4900,
```
to
```ts
    itemId: 'monthly',
    amountSatangs: 24900,
```

Change the `succeededEvent` helper's default from
```ts
    amountSatangs: 4900,
```
to
```ts
    amountSatangs: 24900,
```

In the "grants a subscription with autoRenew false and the right duration"
test, change
```ts
    expect(created.data.planType).toBe('weekly');
```
to
```ts
    expect(created.data.planType).toBe('monthly');
```
and change
```ts
    expect(end.getTime() - start.getTime()).toBe(PLAN_DURATIONS_MS.weekly);
```
to
```ts
    expect(end.getTime() - start.getTime()).toBe(PLAN_DURATIONS_MS.monthly);
```

Delete the entire `'credits coins inside the same transaction as the
payment records'` test.

Remove the line `expect(wallet.credit).not.toHaveBeenCalled();` from each
of these three tests (leave everything else in each test unchanged):
`'treats a duplicate delivery as a no-op and still answers 200'`, `'leaves
an already-SUCCEEDED intent untouched when a late FAILED event lands'`, and
`'still commits the payment record when the catalog item has been
retired'`.

In the `'still commits the payment record when the catalog item has been
retired'` test, change `itemId: 'retired-weekly'` to `itemId:
'retired-monthly'` (cosmetic — the id never matches a real catalog entry
either way, this just avoids a stale reference to a plan that no longer
exists).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/flick-api && npm test -- payments.service`
Expected: FAIL — `payments.service.ts` still imports `WalletService` and
still calls `this.wallet.credit(...)` in `grantEntitlement`, so the
`TestingModule` (which no longer provides `WalletService`) fails to resolve
`PaymentsService`'s dependencies.

- [ ] **Step 3: Update payments.service.ts**

In `apps/flick-api/src/payments/payments.service.ts`, change the imports:

```ts
import { Prisma, SubscriptionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { Tx } from '../wallet/wallet.service';
```

to:

```ts
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
```

`Tx` was only ever a re-export of `Prisma.TransactionClient` from
`wallet.service.ts` (confirmed: `prisma.service.ts` exports no such type).
Define it directly in `payments.service.ts` instead — add this line right
after the imports, before the `INTENT_TTL_MS` constant:

```ts
type Tx = Prisma.TransactionClient;
```

Change the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    private readonly wallet: WalletService,
    config: ConfigService,
  ) {
```

to:

```ts
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    config: ConfigService,
  ) {
```

Replace `grantEntitlement` in full:

```ts
  /** Runs inside the caller's transaction — never opens one of its own. */
  private async grantEntitlement(
    tx: Tx,
    intent: {
      id: string;
      userId: string;
      itemType: string;
      itemId: string;
    },
  ): Promise<void> {
    // Re-resolved server-side rather than trusted from the stored row, so the
    // price/duration source of truth stays plans.config.ts.
    const item = resolveCatalogItem(
      intent.itemType as CatalogItemType,
      intent.itemId,
    );

    const startDate = new Date();
    await tx.subscription.create({
      data: {
        userId: intent.userId,
        planType: intent.itemId,
        status: SubscriptionStatus.ACTIVE,
        // One-time purchases only: no stored card, nothing to auto-charge.
        autoRenew: false,
        startDate,
        endDate: new Date(startDate.getTime() + item.durationMs),
        paymentMethod: this.gateway.name,
      },
    });
    this.logger.log(`Subscription granted for intent ${intent.id}`);
  }
```

`item.durationMs` is no longer optional (`ResolvedCatalogItem.durationMs` is
`number`, not `number | undefined`, per Task 4) so the `?? 0` fallback is
gone.

Find the call site of `grantEntitlement` (inside `handleWebhook`) — it
currently passes `paymentEvent.id` as a third argument:

```ts
          await this.grantEntitlement(tx, intent, paymentEvent.id);
```

Change it to drop the now-unused third parameter:

```ts
          await this.grantEntitlement(tx, intent);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/flick-api && npm test -- payments.service`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `cd apps/flick-api && npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/src/payments
git commit -m "feat(api): drop coin fulfillment from payments.service

grantEntitlement unconditionally creates a subscription now — there
is no second branch once CatalogItemType is subscription-only.
PaymentsService no longer depends on WalletService."
```

---

## Task 6: Backend — e2e specs for the new entitlement and pricing

**Files:**
- Modify: `apps/flick-api/test/entitlement.e2e-spec.ts`
- Modify: `apps/flick-api/test/payments.e2e-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5 — this is the first full-stack
  verification against a real (migrated, seeded) database.
- Produces: nothing downstream; this is the plan's e2e safety net.

**Context:** Three of `payments.e2e-spec.ts`'s tests exercise real payments
safety properties — exactly-once webhook fulfillment, amount-mismatch
rejection, and FAILED-intent immutability — using `COIN_PACK` purchases and
`/wallet` balance deltas as their observation mechanism. Those properties
apply equally to subscription webhooks; deleting the tests outright would
silently drop that coverage. This task ports them to observe
`/subscriptions/me` and a direct `prisma.subscription.count()` instead.

- [ ] **Step 1: Update entitlement.e2e-spec.ts**

In `apps/flick-api/test/entitlement.e2e-spec.ts`, replace the
`'denies a premium episode to a user with no subscription and no coins'`
test:

```ts
  it('denies a premium episode to a user with no subscription and no coins', async () => {
    const response = await request(app.getHttpServer())
      .get(`/playback/${PREMIUM_EPISODE_ID}/authorize`)
      .set('Cookie', freeUserCookie)
      .expect(200);
    const authorization = response.body as {
      allowed: boolean;
      reason: string;
      coinCost: number;
      videoUrl?: string;
    };

    expect(authorization).toMatchObject({
      allowed: false,
      reason: 'coins_required',
      coinCost: 10,
    });
    expect(authorization.videoUrl).toBeUndefined();
  });
```

with:

```ts
  it('denies a premium episode to a user with no subscription', async () => {
    const response = await request(app.getHttpServer())
      .get(`/playback/${PREMIUM_EPISODE_ID}/authorize`)
      .set('Cookie', freeUserCookie)
      .expect(200);
    const authorization = response.body as {
      allowed: boolean;
      reason: string;
      videoUrl?: string;
    };

    expect(authorization).toMatchObject({
      allowed: false,
      reason: 'subscription_required',
    });
    expect(authorization.videoUrl).toBeUndefined();
  });
```

In the `'does not activate paid access from an unverified browser request'`
test, change:

```ts
      .send({ planId: 'weekly' })
```
to:
```ts
      .send({ planId: 'monthly' })
```
and change:
```ts
    expect(response.body).toMatchObject({
      allowed: false,
      reason: 'coins_required',
    });
```
to:
```ts
    expect(response.body).toMatchObject({
      allowed: false,
      reason: 'subscription_required',
    });
```

- [ ] **Step 2: Update payments.e2e-spec.ts pricing references**

In `apps/flick-api/test/payments.e2e-spec.ts`:

Change the `chargeEvent` helper's default:
```ts
    amountSatangs: 4900,
```
to:
```ts
    amountSatangs: 24900,
```

Change every occurrence of the string `'weekly'` used as an `itemId` to
`'monthly'` — five call sites in this file:

```ts
      .send({ itemType: 'SUBSCRIPTION', itemId: 'weekly' })
```
(the `'requires a session to start a checkout'` test), becomes:
```ts
      .send({ itemType: 'SUBSCRIPTION', itemId: 'monthly' })
```

```ts
      .send({ itemType: 'SUBSCRIPTION', itemId: 'weekly', amountSatangs: 1 })
```
(the `'refuses a request that tries to supply its own price'` test), becomes:
```ts
      .send({ itemType: 'SUBSCRIPTION', itemId: 'monthly', amountSatangs: 1 })
```

```ts
    await checkout('SUBSCRIPTION', 'weekly');
```
(the `'grants nothing until a verified webhook arrives'` test), becomes:
```ts
    await checkout('SUBSCRIPTION', 'monthly');
```

```ts
    const intentId = await checkout('SUBSCRIPTION', 'weekly');
```
(this exact line appears twice — in the `'rejects a forged webhook
signature'` test and the `'activates a subscription on a verified webhook'`
test — change both occurrences), becomes:
```ts
    const intentId = await checkout('SUBSCRIPTION', 'monthly');
```

Change:
```ts
    expect(subscription.planType).toBe('weekly');
```
to:
```ts
    expect(subscription.planType).toBe('monthly');
```

- [ ] **Step 3: Port the three coin-based safety tests to subscriptions**

Add `let seededUserId: string;` is already declared — confirm it (it is,
per the file's existing `beforeAll`). Replace the three tests that use
`checkout('COIN_PACK', 'starter')` and `/wallet`:

```ts
  it('is idempotent under duplicate delivery', async () => {
    const intentId = await checkout('COIN_PACK', 'starter');
    const event = chargeEvent(intentId, { amountSatangs: 3500 });

    const before = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    await postWebhook(event).expect(200);
    await postWebhook(event).expect(200); // replay
    await postWebhook(event).expect(200); // and again

    const after = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    const delta =
      (after.body as { balance: number }).balance -
      (before.body as { balance: number }).balance;
    // Credited exactly once, no matter how many times the gateway retried.
    expect(delta).toBe(100);
  });

  it('ignores a webhook whose amount does not match the intent', async () => {
    const intentId = await checkout('COIN_PACK', 'starter');

    const before = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    await postWebhook(chargeEvent(intentId, { amountSatangs: 1 })).expect(200);

    const after = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);
    expect((after.body as { balance: number }).balance).toBe(
      (before.body as { balance: number }).balance,
    );
  });

  it('never lets a later SUCCEEDED overwrite a FAILED intent', async () => {
    const intentId = await checkout('COIN_PACK', 'starter');

    const before = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    await postWebhook(
      chargeEvent(intentId, {
        id: `evt_fail_${intentId}`,
        status: 'FAILED',
        amountSatangs: 3500,
      }),
    ).expect(200);

    await postWebhook(
      chargeEvent(intentId, {
        id: `evt_late_${intentId}`,
        status: 'SUCCEEDED',
        amountSatangs: 3500,
      }),
    ).expect(200);

    const after = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);
    expect((after.body as { balance: number }).balance).toBe(
      (before.body as { balance: number }).balance,
    );
  });
```

with:

```ts
  it('is idempotent under duplicate delivery', async () => {
    await clearSeededUserSubscriptions();
    const intentId = await checkout('SUBSCRIPTION', 'monthly');
    const event = chargeEvent(intentId);

    await postWebhook(event).expect(200);
    await postWebhook(event).expect(200); // replay
    await postWebhook(event).expect(200); // and again

    // Granted exactly once, no matter how many times the gateway retried.
    const count = await prisma.subscription.count({
      where: { userId: seededUserId },
    });
    expect(count).toBe(1);
  });

  it('ignores a webhook whose amount does not match the intent', async () => {
    await clearSeededUserSubscriptions();
    const intentId = await checkout('SUBSCRIPTION', 'monthly');

    await postWebhook(chargeEvent(intentId, { amountSatangs: 1 })).expect(200);

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(me.body).toEqual({});
  });

  it('never lets a later SUCCEEDED overwrite a FAILED intent', async () => {
    await clearSeededUserSubscriptions();
    const intentId = await checkout('SUBSCRIPTION', 'monthly');

    await postWebhook(
      chargeEvent(intentId, {
        id: `evt_fail_${intentId}`,
        status: 'FAILED',
      }),
    ).expect(200);

    await postWebhook(
      chargeEvent(intentId, {
        id: `evt_late_${intentId}`,
        status: 'SUCCEEDED',
      }),
    ).expect(200);

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(me.body).toEqual({});
  });
```

Each ported test calls `clearSeededUserSubscriptions()` first — these three
tests now run in the same "grants a real subscription" family as the
existing `'activates a subscription on a verified webhook'` test just above
them, and each must start from the same known-unentitled state that test
relies on (the file's `beforeAll` already does this once at suite start;
these three do it again immediately before themselves so they do not
depend on running in a specific order relative to each other).

- [ ] **Step 4: Run the full e2e suite**

Run: `cd apps/flick-api && npm run test:e2e`

If `otp_challenges` or the seeded `e2e-free-user` are missing (a fresh
database), run `npx prisma migrate deploy && npm run db:seed` first.

Expected: all suites pass, including the three ported tests and the two
edited entitlement assertions.

- [ ] **Step 5: Full verification**

Run: `cd apps/flick-api && npm test && npm run lint && npm run test:e2e`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/test
git commit -m "test(api): port e2e coverage from coins to subscriptions

Entitlement e2e now expects subscription_required, not coins_required.
Payments e2e's three webhook-safety tests (idempotency, amount
mismatch, FAILED-intent immutability) move from COIN_PACK/wallet
observation to SUBSCRIPTION/prisma.subscription queries — the
properties they guard are not coin-specific and would otherwise lose
coverage entirely."
```

---

## Task 7: Frontend — type contract for the new shapes

**Files:**
- Modify: `apps/flick-app/src/types/index.ts`
- Modify: `apps/flick-app/src/types/api.ts`
- Modify: `apps/flick-app/src/types/api.test.ts`

**Interfaces:**
- Consumes: the API's new `PlaybackAuthorization` and `GET /plans` shapes
  (Tasks 2 and 4).
- Produces: `Episode` with `isPremium: boolean` instead of `coinCost:
  number`. `PlaybackAuthorization`, `ApiPath`, `ApiResponse`, and
  `decodeApiResponse` with no wallet/coin surface. Every later frontend task
  compiles against these.

**Context:** `isPremium` is already in the `/movies` payload today —
`MoviesService.toDto` only strips `videoUrl`. This is a type-only
correction, not an API change.

- [ ] **Step 1: Update types/index.ts**

In `apps/flick-app/src/types/index.ts`, remove `coinBalance` from
`AuthenticatedUser`:

```ts
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  role: 'USER' | 'ADMIN';
  coinBalance: number;
}
```

becomes:

```ts
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  role: 'USER' | 'ADMIN';
}
```

Delete the `WalletResponse` interface:

```ts
export interface WalletResponse {
  balance: number;
}
```

In `Episode`, replace `coinCost: number;` with `isPremium: boolean;`:

```ts
export interface Episode {
  id: string;
  seasonId: string;
  episodeNumber: number;
  title: string;
  description: string | null;
  /** Present only in a successful playback authorization response. */
  videoUrl?: string | null;
  thumbnailUrl: string | null;
  durationMinutes: number;
  coinCost: number;
  releaseDate: string; // ISO string from backend
}
```

becomes:

```ts
export interface Episode {
  id: string;
  seasonId: string;
  episodeNumber: number;
  title: string;
  description: string | null;
  /** Present only in a successful playback authorization response. */
  videoUrl?: string | null;
  thumbnailUrl: string | null;
  durationMinutes: number;
  isPremium: boolean;
  releaseDate: string; // ISO string from backend
}
```

Replace `PlaybackAuthorization`:

```ts
export type PlaybackAuthorization =
  | {
      allowed: true;
      reason: 'free' | 'subscription' | 'unlocked';
      videoUrl: string;
    }
  | {
      allowed: false;
      reason: 'subscription_required' | 'coins_required';
      coinCost: number;
    };
```

becomes:

```ts
export type PlaybackAuthorization =
  | {
      allowed: true;
      reason: 'free' | 'subscription';
      videoUrl: string;
    }
  | {
      allowed: false;
      reason: 'subscription_required';
    };
```

Delete the `CoinPack` interface (the last block in the file):

```ts
export interface CoinPack {
  id: string;
  name: string;
  coins: number;
  price: number;
  unlocks?: string;
  badge?: string;
}
```

Update the `Subscription.planType` comment:

```ts
  planType: string; // 'weekly' | 'monthly' in practice
```

becomes:

```ts
  planType: string; // 'monthly' in practice
```

- [ ] **Step 2: Update types/api.ts**

In `apps/flick-app/src/types/api.ts`, remove `CoinPack` and `WalletResponse`
from the import block:

```ts
import type {
  AuthenticatedUser,
  BookmarkResponse,
  CheckoutResponse,
  CoinPack,
  ContinueWatchingItem,
  DownloadRecord,
  LikeResponse,
  Movie,
  MovieActionsResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  PlaybackAuthorization,
  Subscription,
  SubscriptionPlan,
  WalletResponse,
} from './index';
```

becomes:

```ts
import type {
  AuthenticatedUser,
  BookmarkResponse,
  CheckoutResponse,
  ContinueWatchingItem,
  DownloadRecord,
  LikeResponse,
  Movie,
  MovieActionsResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  PlaybackAuthorization,
  Subscription,
  SubscriptionPlan,
} from './index';
```

Replace `PlansResponse`:

```ts
export interface PlansResponse {
  subscriptions: SubscriptionPlan[];
  coins: CoinPack[];
}
```

becomes:

```ts
export interface PlansResponse {
  subscriptions: SubscriptionPlan[];
}
```

Remove the `'/wallet'` and `'/wallet/spend'` members from `ApiPath`:

```ts
  | '/subscriptions/me'
  | '/wallet'
  | '/wallet/spend'
  | '/payments/checkout'
```

becomes:

```ts
  | '/subscriptions/me'
  | '/payments/checkout'
```

Remove the `/wallet` mapping from `ApiResponse`:

```ts
  : Path extends '/subscriptions/me' ? Subscription | null | undefined
  : Path extends '/wallet' ? WalletResponse
  : Path extends '/payments/checkout' ? CheckoutResponse
```

becomes:

```ts
  : Path extends '/subscriptions/me' ? Subscription | null | undefined
  : Path extends '/payments/checkout' ? CheckoutResponse
```

Update `decodePlans` — remove the `coins` array check and per-pack
validation:

```ts
export function decodePlans(value: unknown): PlansResponse {
  const plans = requireRecord(value, 'plans');
  if (!Array.isArray(plans.subscriptions) || !Array.isArray(plans.coins)) {
    throw new TypeError('Invalid plans collections');
  }
  for (const planValue of plans.subscriptions) {
    const plan = requireRecord(planValue, 'subscription plan');
    if (typeof plan.id !== 'string' || typeof plan.price !== 'number' || !Array.isArray(plan.features)) {
      throw new TypeError('Invalid subscription plan');
    }
  }
  for (const packValue of plans.coins) {
    const pack = requireRecord(packValue, 'coin pack');
    if (typeof pack.id !== 'string' || typeof pack.coins !== 'number' || typeof pack.price !== 'number') {
      throw new TypeError('Invalid coin pack');
    }
  }
  return plans as unknown as PlansResponse;
}
```

becomes:

```ts
export function decodePlans(value: unknown): PlansResponse {
  const plans = requireRecord(value, 'plans');
  if (!Array.isArray(plans.subscriptions)) {
    throw new TypeError('Invalid plans collections');
  }
  for (const planValue of plans.subscriptions) {
    const plan = requireRecord(planValue, 'subscription plan');
    if (typeof plan.id !== 'string' || typeof plan.price !== 'number' || !Array.isArray(plan.features)) {
      throw new TypeError('Invalid subscription plan');
    }
  }
  return plans as unknown as PlansResponse;
}
```

In `decodeApiResponse`, remove the `coinCost` validation from the playback
authorization branch:

```ts
  if (path.startsWith('/playback/') && path.endsWith('/authorize')) {
    const authorization = requireRecord(value, 'playback authorization');
    requireBoolean(authorization, 'allowed');
    if (authorization.allowed) {
      if (typeof authorization.videoUrl !== 'string') throw new TypeError('Invalid playback videoUrl');
    } else {
      requireNumber(authorization, 'coinCost');
    }
    return authorization as ApiResponse<Path>;
  }
```

becomes:

```ts
  if (path.startsWith('/playback/') && path.endsWith('/authorize')) {
    const authorization = requireRecord(value, 'playback authorization');
    requireBoolean(authorization, 'allowed');
    if (authorization.allowed) {
      if (typeof authorization.videoUrl !== 'string') throw new TypeError('Invalid playback videoUrl');
    }
    return authorization as ApiResponse<Path>;
  }
```

Remove the `/wallet` decode branch entirely:

```ts
  if (path === '/wallet') {
    const wallet = requireRecord(value, 'wallet');
    requireNumber(wallet, 'balance');
    return wallet as ApiResponse<Path>;
  }
```

- [ ] **Step 2: Update api.test.ts**

In `apps/flick-app/src/types/api.test.ts`, change:

```ts
    expect(() => decodePlans({ subscriptions: {}, coins: [] })).toThrow('collections');
```

to:

```ts
    expect(() => decodePlans({ subscriptions: {} })).toThrow('collections');
```

- [ ] **Step 3: Run the frontend test suite**

Run: `cd apps/flick-app && npm test`
Expected: FAIL at this point in files that still reference `CoinPack`,
`WalletResponse`, `coinCost`, or `'coins_required'` — those are addressed in
Tasks 8-9. This step's own file (`api.test.ts`) passes; the overall suite
does not yet, which is expected mid-refactor. Confirm specifically that
`npm test -- api.test` (the file this task owns) passes:

Run: `cd apps/flick-app && npm test -- src/types/api.test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/flick-app/src/types
git commit -m "feat(app): type contract for subscription-only entitlement

Episode.coinCost -> isPremium (already in the /movies payload; this
was a type-only gap). PlaybackAuthorization, WalletResponse, CoinPack,
and the /wallet API paths are gone. This intentionally leaves the
rest of the app red until Tasks 8-9 land in the same session."
```

---

## Task 8: Frontend — checkout, gate sheet, and every remaining reference

**Files:**
- Modify: `apps/flick-app/src/features/payments/api.ts`
- Modify: `apps/flick-app/src/features/payments/api.test.ts`
- Modify: `apps/flick-app/src/app/subscribe/processing/page.tsx`
- Modify: `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`
- Modify: `apps/flick-app/src/app/subscribe/page.tsx`
- Modify: `apps/flick-app/src/app/player/[id]/PlayerClient.tsx`
- Modify: `apps/flick-app/src/app/player/[id]/page.tsx`
- Modify: `apps/flick-app/src/features/playback/hooks/usePlaybackAuthorization.ts`
- Modify: `apps/flick-app/src/features/playback/hooks/usePlaybackAuthorization.test.tsx`
- Modify: `apps/flick-app/src/app/(app)/discover/DiscoverClient.tsx`
- Modify: `apps/flick-app/src/app/movie/[id]/MovieClient.tsx`
- Modify: `apps/flick-app/src/components/ui/AppHeader.tsx`
- Modify: `apps/flick-app/src/app/(app)/profile/page.tsx`
- Modify: `apps/flick-app/src/app/(app)/home/page.tsx`
- Modify: `apps/flick-app/src/components/ui/Icon.tsx`
- Modify: `apps/flick-app/src/components/ui/Toast.tsx`
- Modify: `apps/flick-app/src/app/layout.tsx`
- Modify: `apps/flick-app/src/app/(app)/home/HomeClient.tsx`
- Modify: `apps/flick-app/src/app/LandingClient.tsx`
- Modify: `apps/flick-app/src/app/globals.css`

**Interfaces:**
- Consumes: `PlaybackAuthorization`, `Episode.isPremium`, `PlansResponse`
  (Task 7).
- Produces: a fully green frontend build. Nothing downstream of this task —
  it is the last frontend edit.

**Context:** This is the largest task in the plan because it is genuinely
one unit of work: the gate sheet, the checkout recovery path, and every
`text-coin` consumer all depend on the same type changes from Task 7 and
none of them compile independently until all are updated together. Two
non-obvious edits are called out inline: `checkGranted`'s `itemType === null`
branch must survive (it is the returning-user recovery path, not coin
code), and `--color-coin` is renamed, not deleted (four of its consumers are
unrelated gold accents).

- [ ] **Step 1: Write the failing test changes for the payments feature**

Replace the full contents of `apps/flick-app/src/features/payments/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/apiClient';
import {
  checkGranted,
  recallPendingCheckout,
  rememberPendingCheckout,
  INITIAL_CHECKOUT_BASELINE,
  type CheckoutBaseline,
} from './api';

vi.mock('@/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function subscription(endDate: string) {
  return {
    id: 'sub-1',
    userId: 'user-1',
    planType: 'monthly',
    status: 'ACTIVE' as const,
    autoRenew: false,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate,
    paymentMethod: 'fake',
    gatewaySubscriptionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('checkGranted — SUBSCRIPTION', () => {
  it('grants a first-time purchase (no baseline) as soon as any subscription appears', async () => {
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const baseline: CheckoutBaseline = { subscriptionEndDate: null };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(true);
  });

  it('does NOT grant a renewal-before-expiry just because the OLD subscription still exists', async () => {
    const oldEndDate = '2026-09-01T00:00:00.000Z';
    mockedApiFetch.mockResolvedValueOnce(subscription(oldEndDate));

    const baseline: CheckoutBaseline = { subscriptionEndDate: oldEndDate };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(false);
  });

  it('grants a renewal once a subscription with a LATER endDate appears', async () => {
    const oldEndDate = '2026-09-01T00:00:00.000Z';
    const newEndDate = '2026-10-01T00:00:00.000Z';
    mockedApiFetch.mockResolvedValueOnce(subscription(newEndDate));

    const baseline: CheckoutBaseline = { subscriptionEndDate: oldEndDate };
    const result = await checkGranted('SUBSCRIPTION', baseline);

    expect(result.granted).toBe(true);
  });

  it('does not grant when no subscription exists yet', async () => {
    mockedApiFetch.mockResolvedValueOnce(undefined);

    const result = await checkGranted('SUBSCRIPTION', { subscriptionEndDate: null });

    expect(result.granted).toBe(false);
  });

  it('falls back to granting on any subscription when the baseline was never captured', async () => {
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const result = await checkGranted('SUBSCRIPTION', {
      subscriptionEndDate: undefined,
    });

    expect(result.granted).toBe(true);
  });
});

describe('checkGranted — item type unknown (sessionStorage fallback)', () => {
  it('captures the baseline on the first tick instead of granting on a pre-existing subscription', async () => {
    // First tick: no sessionStorage data (itemType unknown, e.g. a
    // different tab). The pre-existing subscription is captured as the
    // baseline, not treated as a grant.
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));

    const first = await checkGranted(null, INITIAL_CHECKOUT_BASELINE);
    expect(first.granted).toBe(false);
    expect(first.baseline).toEqual({ subscriptionEndDate: '2026-09-23T00:00:00.000Z' });

    // Second tick: the SAME pre-existing subscription is still there —
    // still no grant.
    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));
    const second = await checkGranted(null, first.baseline);
    expect(second.granted).toBe(false);
  });

  it('grants when a subscription with a later endDate appears after the baseline tick', async () => {
    mockedApiFetch.mockResolvedValueOnce(undefined); // /subscriptions/me — nothing yet

    const first = await checkGranted(null, INITIAL_CHECKOUT_BASELINE);
    expect(first.granted).toBe(false);
    expect(first.baseline.subscriptionEndDate).toBeNull();

    mockedApiFetch.mockResolvedValueOnce(subscription('2026-09-23T00:00:00.000Z'));
    const second = await checkGranted(null, first.baseline);
    expect(second.granted).toBe(true);
  });
});

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
    await rememberPendingCheckout('SUBSCRIPTION', 'pi_3');
    expect(recallPendingCheckout('pi_3')?.next ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/flick-app && npm test -- src/features/payments/api.test`
Expected: FAIL — `api.ts` still defines `CheckoutItemType` as `'SUBSCRIPTION'
| 'COIN_PACK'`, `CheckoutBaseline` still requires a `balance` field, and
`checkGranted` still branches on `'COIN_PACK'` and reads `baseline.balance`,
so the narrowed `CheckoutBaseline` object literals in this test (missing
`balance`) do not satisfy the current type, and `mockedApiFetch` is called
once per tick in the real code (two calls: subscriptions + wallet) versus
once in these new tests' `mockResolvedValueOnce` sequencing.

- [ ] **Step 3: Update features/payments/api.ts**

In `apps/flick-app/src/features/payments/api.ts`, change:

```ts
export type CheckoutItemType = 'SUBSCRIPTION' | 'COIN_PACK';
```

to:

```ts
export type CheckoutItemType = 'SUBSCRIPTION';
```

Change the `PendingCheckout` interface — remove `baselineBalance`:

```ts
interface PendingCheckout {
  itemType: CheckoutItemType;
  intentId: string;
  /** Wallet balance captured right before leaving for the gateway. COIN_PACK
   *  only. Lets the processing screen notice a credit that lands before the
   *  screen itself ever mounts — a plain "did it change since I loaded"
   *  check would miss that case. */
  baselineBalance?: number;
  /** The active subscription's endDate (if any) at the moment checkout was
   *  started, or null if there was no active subscription. SUBSCRIPTION
   *  only. Renewal-before-expiry is a real flow here (no auto-renew — see
   *  the plan doc — so buying again while still entitled is expected), so
   *  "a subscription exists" is not proof of a NEW grant; only "a
   *  subscription with a later endDate than this baseline" is. Left
   *  undefined if the pre-checkout fetch failed — the processing screen
   *  then falls back to treating any subscription as a grant, same as it
   *  would for a genuine first-time purchase. */
  baselineSubscriptionEndDate?: string | null;
  /** Where to land once the grant is confirmed. Validated on the way in and
   *  again on the way out: sessionStorage is writable by any script on the
   *  origin, so a stored value is no more trusted than a URL param. */
  next?: string;
}
```

becomes:

```ts
interface PendingCheckout {
  itemType: CheckoutItemType;
  intentId: string;
  /** The active subscription's endDate (if any) at the moment checkout was
   *  started, or null if there was no active subscription. Renewal-before-
   *  expiry is a real flow here (no auto-renew — see the plan doc — so
   *  buying again while still entitled is expected), so "a subscription
   *  exists" is not proof of a NEW grant; only "a subscription with a later
   *  endDate than this baseline" is. Left undefined if the pre-checkout
   *  fetch failed — the processing screen then falls back to treating any
   *  subscription as a grant, same as it would for a genuine first-time
   *  purchase. */
  baselineSubscriptionEndDate?: string | null;
  /** Where to land once the grant is confirmed. Validated on the way in and
   *  again on the way out: sessionStorage is writable by any script on the
   *  origin, so a stored value is no more trusted than a URL param. */
  next?: string;
}
```

In `rememberPendingCheckout`, remove the `COIN_PACK` branch:

```ts
  const pending: PendingCheckout = { itemType, intentId };
  const safe = safeNext(next);
  if (safe) pending.next = safe;
  if (itemType === 'COIN_PACK') {
    try {
      const wallet = await apiFetch('/wallet');
      pending.baselineBalance = wallet.balance;
    } catch {
      // No baseline available — the processing screen uses its first poll
      // as the baseline instead.
    }
  } else {
    try {
      const subscription = await apiFetch('/subscriptions/me');
      pending.baselineSubscriptionEndDate = subscription ? subscription.endDate : null;
    } catch {
      // No baseline available — left undefined, so the processing screen
      // grants on any subscription appearing (same as a first-time buyer).
    }
  }
```

becomes:

```ts
  const pending: PendingCheckout = { itemType, intentId };
  const safe = safeNext(next);
  if (safe) pending.next = safe;
  try {
    const subscription = await apiFetch('/subscriptions/me');
    pending.baselineSubscriptionEndDate = subscription ? subscription.endDate : null;
  } catch {
    // No baseline available — left undefined, so the processing screen
    // grants on any subscription appearing (same as a first-time buyer).
  }
```

In `recallPendingCheckout`, simplify the itemType guard:

```ts
    if (
      (parsed.itemType !== 'SUBSCRIPTION' && parsed.itemType !== 'COIN_PACK') ||
      typeof parsed.intentId !== 'string'
    ) {
      return null;
    }
```

becomes:

```ts
    if (parsed.itemType !== 'SUBSCRIPTION' || typeof parsed.intentId !== 'string') {
      return null;
    }
```

Replace `CheckoutBaseline`:

```ts
export interface CheckoutBaseline {
  balance: number | null;
  /** undefined = never captured (fetch failed, or not applicable to this
   *  poll yet); null = captured, no active subscription existed; string =
   *  captured, the pre-existing subscription's endDate. */
  subscriptionEndDate: string | null | undefined;
}

export const INITIAL_CHECKOUT_BASELINE: CheckoutBaseline = {
  balance: null,
  subscriptionEndDate: undefined,
};
```

becomes:

```ts
export interface CheckoutBaseline {
  /** undefined = never captured (fetch failed, or not applicable to this
   *  poll yet); null = captured, no active subscription existed; string =
   *  captured, the pre-existing subscription's endDate. */
  subscriptionEndDate: string | null | undefined;
}

export const INITIAL_CHECKOUT_BASELINE: CheckoutBaseline = {
  subscriptionEndDate: undefined,
};
```

Replace `checkGranted` in full:

```ts
export async function checkGranted(
  itemType: CheckoutItemType | null,
  baseline: CheckoutBaseline,
): Promise<{ granted: boolean; baseline: CheckoutBaseline }> {
  if (itemType === 'SUBSCRIPTION') {
    const subscription = await apiFetch('/subscriptions/me');
    return {
      granted: isNewerSubscription(subscription, baseline.subscriptionEndDate),
      baseline,
    };
  }

  if (itemType === 'COIN_PACK') {
    const wallet = await apiFetch('/wallet');
    if (baseline.balance === null) {
      // No baseline could be captured before checkout (sessionStorage lost
      // it, or the pre-checkout /wallet read failed) — this poll becomes the
      // baseline instead. A false negative for this one tick is the honest
      // trade-off: we cannot claim "granted" without something to compare to.
      return { granted: false, baseline: { ...baseline, balance: wallet.balance } };
    }
    return { granted: wallet.balance > baseline.balance, baseline };
  }

  // Item type unknown (different tab/device, cleared storage, or a direct
  // navigation to this URL) — watch both signals so a real grant is still
  // caught. Whichever baseline is still missing gets CAPTURED on this tick
  // rather than compared, so a pre-existing subscription or coin balance can
  // never itself read as "granted" — mirrors the COIN_PACK branch above.
  const [subscription, wallet] = await Promise.all([
    apiFetch('/subscriptions/me'),
    apiFetch('/wallet'),
  ]);

  const nextBaseline: CheckoutBaseline = { ...baseline };
  let granted = false;

  if (baseline.balance === null) {
    nextBaseline.balance = wallet.balance;
  } else if (wallet.balance > baseline.balance) {
    granted = true;
  }

  if (baseline.subscriptionEndDate === undefined) {
    nextBaseline.subscriptionEndDate = subscription ? subscription.endDate : null;
  } else if (isNewerSubscription(subscription, baseline.subscriptionEndDate)) {
    granted = true;
  }

  return { granted, baseline: nextBaseline };
}
```

becomes:

```ts
export async function checkGranted(
  itemType: CheckoutItemType | null,
  baseline: CheckoutBaseline,
): Promise<{ granted: boolean; baseline: CheckoutBaseline }> {
  if (itemType === 'SUBSCRIPTION') {
    const subscription = await apiFetch('/subscriptions/me');
    return {
      granted: isNewerSubscription(subscription, baseline.subscriptionEndDate),
      baseline,
    };
  }

  // Item type unknown (different tab/device, cleared storage, or a direct
  // navigation to this URL). The baseline gets CAPTURED on this tick rather
  // than compared, so a pre-existing subscription can never itself read as
  // "granted".
  const subscription = await apiFetch('/subscriptions/me');

  if (baseline.subscriptionEndDate === undefined) {
    return {
      granted: false,
      baseline: { subscriptionEndDate: subscription ? subscription.endDate : null },
    };
  }

  return {
    granted: isNewerSubscription(subscription, baseline.subscriptionEndDate),
    baseline,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/flick-app && npm test -- src/features/payments/api.test`
Expected: PASS.

- [ ] **Step 5: Update the processing screen**

In `apps/flick-app/src/app/subscribe/processing/page.tsx`, change:

```ts
    let baseline: CheckoutBaseline = {
      balance: pending?.baselineBalance ?? INITIAL_CHECKOUT_BASELINE.balance,
      subscriptionEndDate: pending ? pending.baselineSubscriptionEndDate : INITIAL_CHECKOUT_BASELINE.subscriptionEndDate,
    };
```

to:

```ts
    let baseline: CheckoutBaseline = {
      subscriptionEndDate: pending ? pending.baselineSubscriptionEndDate : INITIAL_CHECKOUT_BASELINE.subscriptionEndDate,
    };
```

- [ ] **Step 6: Rewrite SubscribeClient — delete the coin-pack section**

Replace the full contents of `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`:

```tsx
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Icon } from '@/components/ui/Icon';
import { rememberPendingCheckout, startCheckout } from '@/features/payments';
import { SubscriptionPlan } from '@/types';

const FREE_PLAN_ID = 'free';

/** Plan copy remains server-owned: SubscriptionPlan ids and prices come
 *  straight from GET /plans and are never re-derived on the client. What
 *  this component sends to POST /payments/checkout is only the chosen id —
 *  never a price — so the server-resolved catalog amount is the only
 *  amount that can ever be charged. */
function SubscribeForm({ plans }: { plans: SubscriptionPlan[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const handleBuy = async (itemId: string) => {
    setBusyItem(itemId);
    setError('');
    const result = await startCheckout('SUBSCRIPTION', itemId);
    if (!result.success) {
      setBusyItem(null);
      setError(result.error);
      return;
    }
    // Remembered so /subscribe/processing knows what to poll for — the
    // gateway's return URL only carries the intent id, not the item type.
    await rememberPendingCheckout('SUBSCRIPTION', result.intentId, searchParams.get('next'));
    // Full navigation, not router.push — the checkout page is the gateway's
    // origin, not ours. location.assign(), not `location.href =`: this
    // version's react-hooks/react-compiler lint rule flags a direct property
    // assignment on `window.location` from inside a component as mutating a
    // frozen value; the equivalent method call is not flagged (see how
    // PlayerClient.tsx's existing window.location.reload() call passes).
    window.location.assign(result.checkoutUrl);
  };

  return (
    <div className="min-h-dvh bg-ink pb-10">
      <Container>
        <header className="flex items-center gap-3 py-4">
          <button
            onClick={() => router.push('/home')}
            aria-label="ปิด"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-fg/10 text-fg transition-all duration-surface ease-enter hover:bg-fg/15 active:scale-90"
          >
            <Icon name="close" size={18} />
          </button>
          <h1 className="text-title font-display">เลือกแพ็กเกจของคุณ</h1>
        </header>
      </Container>

      <Container>
        <section>
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-center gap-2 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail"
            >
              <Icon name="alertCircle" size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col gap-5 md:grid md:grid-cols-2 md:items-start">
            {plans.map((plan) => {
              // The free plan is identified from the data, never from JSX order.
              const isFree = plan.id === FREE_PLAN_ID || plan.price === 0;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-3xl border p-6 shadow-lg shadow-black/20 transition-all duration-surface ease-enter ${isFree ? 'border-brand-ink' : 'border-white/10'}`}
                >
                  {plan.badge && (
                    <span className="absolute -top-2.5 right-5 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink">
                      {plan.badge}
                    </span>
                  )}
                  <h2 className="font-display text-lg font-bold text-fg">{plan.name}</h2>
                  <div className="mt-1 text-2xl font-extrabold text-fg">
                    ฿{plan.price} <span className="text-sm font-normal text-fg-dim">{plan.period}</span>
                  </div>
                  <ul className="mt-4 flex flex-col gap-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-fg-dim">
                        <Icon name="checkCircle" size={16} className="shrink-0 text-ok" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {isFree ? (
                    <button
                      onClick={() => router.push('/home')}
                      className="focus-ring mt-5 flex h-11 w-full items-center justify-center rounded-full bg-brand font-semibold text-ink shadow-lg shadow-black/25 transition-all duration-surface ease-enter hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
                    >
                      ใช้งานฟรี
                    </button>
                  ) : (
                    <Button
                      variant="primary"
                      size="lg"
                      className="mt-5 w-full"
                      loading={busyItem === plan.id}
                      disabled={busyItem !== null && busyItem !== plan.id}
                      onClick={() => handleBuy(plan.id)}
                    >
                      สมัครแพ็กเกจนี้
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </Container>
    </div>
  );
}

// useSearchParams bails a static build's Client Component tree out to client
// rendering up to the nearest Suspense boundary; without one, `next build`
// fails with "Missing Suspense boundary with useSearchParams" (same fix as
// /login and /subscribe/processing).
export default function SubscribeClient({ plans }: { plans: SubscriptionPlan[] }) {
  return (
    <Suspense fallback={null}>
      <SubscribeForm plans={plans} />
    </Suspense>
  );
}
```

Note the grid changes from `md:grid-cols-3` to `md:grid-cols-2` — there are
only two plans now (free, monthly).

- [ ] **Step 7: Update subscribe/page.tsx**

Replace the full contents of `apps/flick-app/src/app/subscribe/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import SubscribeClient from './SubscribeClient';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { ToastProvider } from '@/components/ui/Toast';
import API_BASE_URL from '@/lib/api';
import { getSession } from '@/lib/session';
import { withNext } from '@/lib/nextParam';
import type { SubscriptionPlan } from '@/types';
import { decodePlans } from '@/types/api';

interface PlansResponse {
  subscriptions: SubscriptionPlan[];
}

async function getPlans(): Promise<PlansResponse> {
  const response = await fetch(`${API_BASE_URL}/plans`, { next: { revalidate: 300 } });
  if (!response.ok) throw new Error('Failed to fetch plans');
  return decodePlans(await response.json());
}

// Keep plan selection inside the authenticated membership area, even while
// paid actions are disabled pending a payment-gateway integration.
//
// Safe for the registration flow: /register only pushes here after POST
// /auth/register has already set the session cookie, so the cookie exists by
// the time this Server Component runs.
export default async function SubscribePage() {
  const session = await getSession();
  if (!session) redirect(withNext('/login', '/subscribe'));

  let data: PlansResponse | null = null;
  try {
    data = await getPlans();
  } catch (error) {
    console.error('Error fetching plans on server:', error);
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message="ไม่สามารถโหลดแพ็กเกจได้" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <SubscribeClient plans={data.subscriptions} />
    </ToastProvider>
  );
}
```

- [ ] **Step 8: Collapse the gate sheet in PlayerClient**

In `apps/flick-app/src/app/player/[id]/PlayerClient.tsx`:

Remove `initialBalance` from the props destructuring and its type:

```ts
export default function PlayerClient({
  episodeId,
  initialMovie,
  initialEpisode,
  initialAuthorization,
  initialBalance,
  plans,
}: {
  episodeId: string;
  initialMovie: Movie;
  initialEpisode: Episode;
  initialAuthorization: PlaybackAuthorization;
  initialBalance: number;
  plans: SubscriptionPlan[];
}) {
```

becomes:

```ts
export default function PlayerClient({
  episodeId,
  initialMovie,
  initialEpisode,
  initialAuthorization,
  plans,
}: {
  episodeId: string;
  initialMovie: Movie;
  initialEpisode: Episode;
  initialAuthorization: PlaybackAuthorization;
  plans: SubscriptionPlan[];
}) {
```

Remove the `balance` state line:

```ts
  const [balance] = useState(initialBalance);
```

Change the `useEntitlement` destructuring — remove `unlocking` and
`unlockWithCoins`:

```ts
  const {
    movie,
    episode,
    videoUrl,
    gate,
    error: entitlementError,
    gateError,
    unlocking,
    unlockWithCoins,
  } = useEntitlement(episodeId, router, initialMovie, initialEpisode, initialAuthorization);
```

becomes:

```ts
  const {
    movie,
    episode,
    videoUrl,
    gate,
    error: entitlementError,
    gateError,
  } = useEntitlement(episodeId, router, initialMovie, initialEpisode, initialAuthorization);
```

Replace the entire gate sheet block — from the `{/* Paywall gate` comment
through the closing `)}` of the ternary, i.e. everything currently reading:

```tsx
      {/* Paywall gate — a sheet, not a centered modal: it reads as a drawer
          over content the user is still connected to (the poster stays
          visible behind it), which is also the actual sales argument
          (Part 3). Branches on balance for the coin-gated case; the
          subscription-required case still routes to /subscribe rather than
          inlining the plan comparison, which is a larger scope deferred
          past this pass. */}
      <Sheet
        open={gate !== null}
        onClose={closeGate}
        title={gate?.reason === 'coins_required' ? 'ปลดล็อกตอนนี้' : 'สมัครสมาชิกเพื่อรับชม'}
      >
        {gate?.reason === 'coins_required' ? (
          balance !== null && balance < gate.coinCost ? (
            <>
              <p className="text-sm text-fg-dim">
                เหรียญไม่พอ · มี {balance} จาก {gate.coinCost}
              </p>
              <Button variant="secondary" onClick={() => router.push(`/movie/${movie.id}`)} className="mt-4 w-full">
                ดูตอนฟรี
              </Button>
              <Button
                variant="primary"
                onClick={() => router.push(withNext('/subscribe', returnPath))}
                className="mt-2 w-full"
              >
                ดูแพ็กเกจสมาชิก
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-dim">
                {balance !== null ? (
                  <>
                    <span className="text-data text-coin">◆ {balance}</span>
                    {' → '}
                    <span className="text-data text-coin">◆ {balance - gate.coinCost}</span>
                  </>
                ) : (
                  `ตอนนี้ใช้ ${gate.coinCost} เหรียญ`
                )}
              </p>
              <Button
                variant="primary"
                onClick={() => void unlockWithCoins()}
                loading={unlocking}
                className="mt-4 w-full"
              >
                {unlocking ? 'กำลังปลดล็อก…' : `ใช้ ${gate.coinCost} เหรียญ`}
              </Button>
              <Button
                variant="secondary"
                onClick={() => router.push(withNext('/subscribe', returnPath))}
                className="mt-2 w-full"
              >
                ดูแพ็กเกจสมาชิก
              </Button>
            </>
          )
        ) : (
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
        )}
```

with:

```tsx
      {/* Paywall gate — a sheet, not a centered modal: it reads as a drawer
          over content the user is still connected to (the poster stays
          visible behind it), which is also the actual sales argument
          (Part 3). */}
      <Sheet open={gate !== null} onClose={closeGate} title="สมัครสมาชิกเพื่อรับชม">
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
```

(the `{gateError && (...)}` block immediately following stays exactly as it
is — it is outside the section replaced above).

- [ ] **Step 9: Drop initialBalance from player/[id]/page.tsx**

In `apps/flick-app/src/app/player/[id]/page.tsx`, remove the
`initialBalance={session.coinBalance}` line from the `<PlayerClient>` call.

- [ ] **Step 10: Drop unlockWithCoins from usePlaybackAuthorization**

In `apps/flick-app/src/features/playback/hooks/usePlaybackAuthorization.ts`,
remove the `unlocking` state:

```ts
  const [gateError, setGateError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
```

becomes:

```ts
  const [gateError, setGateError] = useState<string | null>(null);
```

Delete the entire `unlockWithCoins` callback:

```ts
  const unlockWithCoins = useCallback(async () => {
    setUnlocking(true);
    setGateError(null);
    try {
      await apiFetch('/wallet/spend', {
        method: 'POST',
        body: JSON.stringify({ episodeId }),
      });
      await authorize();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setGateError(err instanceof ApiError ? err.message : 'ไม่สามารถปลดล็อกตอนนี้ได้');
    } finally {
      setUnlocking(false);
    }
  }, [authorize, episodeId, router]);
```

Change the return statement:

```ts
  return { videoUrl, gate, error, gateError, unlocking, authorize, unlockWithCoins };
```

to:

```ts
  return { videoUrl, gate, error, gateError, authorize };
```

Note `setGateError` is still used inside `applyAuthorization` (it clears
`gateError` on a successful authorization) — leave that untouched.

- [ ] **Step 11: Fix the DiscoverClient gate branch**

In `apps/flick-app/src/app/(app)/discover/DiscoverClient.tsx`, change:

```tsx
      {gate && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-8 text-center">
          <Icon name="bookmarkFilled" size={28} className="text-coin" />
          <p className="text-sm text-fg-dim">
            {gate.reason === 'coins_required'
              ? `ตอนนี้ใช้ ${gate.coinCost} เหรียญ`
              : 'เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น'}
          </p>
          <Button variant="primary" onClick={() => router.push(`/movie/${movie.id}`)}>
            ดูรายละเอียด
          </Button>
        </div>
      )}
```

to:

```tsx
      {gate && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-8 text-center">
          <Icon name="bookmarkFilled" size={28} className="text-gold" />
          <p className="text-sm text-fg-dim">เนื้อหานี้สงวนไว้สำหรับสมาชิกพรีเมียมเท่านั้น</p>
          <Button variant="primary" onClick={() => router.push(`/movie/${movie.id}`)}>
            ดูรายละเอียด
          </Button>
        </div>
      )}
```

- [ ] **Step 12: Replace the coin badge in MovieClient with a premium badge**

In `apps/flick-app/src/app/movie/[id]/MovieClient.tsx`, change:

```tsx
                  className={`flex items-center gap-3 rounded-2xl border border-white/5 bg-ink-1 p-3 transition-all duration-surface ease-enter [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:bg-ink-2 ${ep.coinCost > 0 ? 'opacity-80' : ''}`}
```

to:

```tsx
                  className={`flex items-center gap-3 rounded-2xl border border-white/5 bg-ink-1 p-3 transition-all duration-surface ease-enter [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:bg-ink-2 ${ep.isPremium ? 'opacity-80' : ''}`}
```

and change:

```tsx
                      {ep.coinCost > 0 && (
                        <span className="text-xs font-medium text-coin">ล็อก · {ep.coinCost} เหรียญ</span>
                      )}
```

to:

```tsx
                      {ep.isPremium && (
                        <span className="flex items-center gap-1 text-xs font-medium text-gold">
                          <Icon name="lock" size={12} />
                          พรีเมียม
                        </span>
                      )}
```

- [ ] **Step 13: Drop the coin balance from AppHeader**

Replace the full contents of `apps/flick-app/src/components/ui/AppHeader.tsx`:

```tsx
import Link from 'next/link';
import { Icon } from './Icon';
import { HeaderNav } from './HeaderNav';

interface AppHeaderProps {
  greeting?: string;
  activeAction?: 'downloads' | 'search';
  variant?: 'solid' | 'overlay';
}

const actions = [
  { name: 'downloads' as const, href: '/downloads', label: 'รายการของฉัน', icon: 'bookmark' as const },
  { name: 'search' as const, href: '/search', label: 'ค้นหา', icon: 'search' as const },
];

export function AppHeader({ greeting, activeAction, variant = 'solid' }: AppHeaderProps) {
  return (
    // Height is defined by --spacing-header in globals.css, not a literal
    // here: SearchClient's filter bar sticks at top-header against the same
    // token, and the root's scroll-padding-top is derived from it too.
    <header
      className={`sticky top-0 z-[100] flex h-header items-center justify-between px-5 backdrop-blur-sm md:px-8 lg:px-10 ${
        variant === 'overlay' ? 'bg-gradient-to-b from-black/90 to-transparent' : 'bg-ink/95'
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        {greeting && <span className="truncate text-[13px] text-fg-mute">สวัสดี, {greeting}</span>}
      </div>
      <HeaderNav />
      <div className="flex items-center gap-3">
        {actions.map((action) => {
          const className = `flex h-8 w-8 items-center justify-center rounded-full transition-all duration-ui ease-enter active:scale-90 ${
            activeAction === action.name ? 'bg-brand-ink/10 text-brand-ink' : 'bg-fg/10 text-fg hover:bg-fg/15'
          }`;
          return activeAction === action.name ? (
            <span key={action.name} aria-label={action.label} className={className}>
              <Icon name={action.icon} size={18} />
            </span>
          ) : (
            <Link
              key={action.name}
              href={action.href}
              aria-label={action.label}
              className={`focus-ring ${className}`}
            >
              <Icon name={action.icon} size={18} />
            </Link>
          );
        })}
      </div>
    </header>
  );
}
```

- [ ] **Step 14: Update profile/page.tsx**

In `apps/flick-app/src/app/(app)/profile/page.tsx`, remove `weekly` from
`PLAN_LABELS`:

```ts
const PLAN_LABELS: Record<string, string> = {
  weekly: 'VIP รายสัปดาห์',
  monthly: 'VIP รายเดือน',
};
```

becomes:

```ts
const PLAN_LABELS: Record<string, string> = {
  monthly: 'VIP รายเดือน',
};
```

Remove the `wallet` state and its fetch. Change:

```ts
  let subscription: Subscription | null = null;
  let wallet: { balance: number } | null = null;
  let sessionExpired = false;
  let error: string | null = null;

  // Both calls sit in one try deliberately: unlike /home's optional bookmarks
  // row, neither of these can degrade independently — membership status and
  // coin balance are the entire point of this page, so a partial render would
  // be a page that lies about the user's entitlements.
  try {
    const [sub, w] = await Promise.all([
      apiFetchServer('/subscriptions/me'),
      apiFetchServer('/wallet'),
    ]);
    // GET /subscriptions/me answers "no subscription" with an empty 200 body,
    // which unwrapResponse surfaces as undefined.
    subscription = sub ?? null;
    wallet = w;
  } catch (err) {
```

to:

```ts
  let subscription: Subscription | null = null;
  let sessionExpired = false;
  let error: string | null = null;

  try {
    const sub = await apiFetchServer('/subscriptions/me');
    // GET /subscriptions/me answers "no subscription" with an empty 200 body,
    // which unwrapResponse surfaces as undefined.
    subscription = sub ?? null;
  } catch (err) {
```

Delete the coin balance card:

```tsx
              <div className="rounded-2xl border border-white/5 bg-ink-1 p-5">
                <h3 className="text-xs font-medium text-fg-dim">เหรียญคงเหลือ</h3>
                <p className="mt-1 flex items-center gap-1.5 text-data font-medium text-coin">
                  <Icon name="coin" size={18} />
                  {wallet?.balance ?? 0}
                </p>
              </div>
```

- [ ] **Step 15: Drop coinBalance prop from home/page.tsx**

In `apps/flick-app/src/app/(app)/home/page.tsx`, change:

```tsx
      <AppHeader greeting={session.displayName} coinBalance={session.coinBalance} variant="overlay" />
```

to:

```tsx
      <AppHeader greeting={session.displayName} variant="overlay" />
```

- [ ] **Step 16: Remove the coin icon glyph**

In `apps/flick-app/src/components/ui/Icon.tsx`, remove `'coin'` from the
`IconName` union:

```ts
  | 'coin'
```

and remove the `coin` glyph definition:

```ts
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.6-1 1.4-2.5 1.9-2.5 1-2.5 1.9 1.1 1.6 2.5 1.6 2.5-.7 2.5-1.7" />
      <line x1="12" y1="6" x2="12" y2="7.4" />
      <line x1="12" y1="16.6" x2="12" y2="18" />
    </>
  ),
```

- [ ] **Step 17: Reword the Toast.tsx comments**

In `apps/flick-app/src/components/ui/Toast.tsx`, change:

```ts
/**
 * One feedback channel for the whole app. Specified in FRONTEND_PLAN.md
 * Part 3 and never built, which is why a coin unlock succeeds silently and
 * the player's notice could sit over a scene for the rest of an episode.
 *
 * A queue rather than a single slot: a coin spend that fails and a playback
 * warning can land in the same second, and dropping one of them is how a
 * user ends up not knowing why nothing happened.
 */
```

to:

```ts
/**
 * One feedback channel for the whole app. Specified in FRONTEND_PLAN.md
 * Part 3 and never built, which is why the player's notice could sit over
 * a scene for the rest of an episode.
 *
 * A queue rather than a single slot: a like/bookmark action that fails and
 * a playback warning can land in the same second, and dropping one of them
 * is how a user ends up not knowing why nothing happened.
 */
```

- [ ] **Step 18: Reword the layout.tsx font comment**

In `apps/flick-app/src/app/layout.tsx`, change:

```ts
// Data face — tabular figures for timecodes, coin balances, episode numbers.
```

to:

```ts
// Data face — tabular figures for timecodes, prices, episode numbers.
```

- [ ] **Step 19: Rename the --color-coin token to --color-gold**

In `apps/flick-app/src/app/globals.css`, change:

```css
  /* bg-brand is a FILL (6.44:1 with --color-ink text on top; white text only
     reaches 3.09:1, which fails normal-text AA, so still pair bg-brand with
     text-ink everywhere, icons included, for one consistent rule regardless
     of fill brightness). text-brand-ink is an INK (7.85:1 on --color-ink)
     for the brand hue used directly as text/icon color. Distinct from
     --color-coin (vivid orange-red vs. coin's paler yellow-gold) so brand
     actions and the coin economy stay visually separable. */
  --color-brand: #FF5C1A;
  --color-brand-ink: #F68355;
  --color-brand-deep: #C23700;
  --color-coin: #E8B84B;
```

to:

```css
  /* bg-brand is a FILL (6.44:1 with --color-ink text on top; white text only
     reaches 3.09:1, which fails normal-text AA, so still pair bg-brand with
     text-ink everywhere, icons included, for one consistent rule regardless
     of fill brightness). text-brand-ink is an INK (7.85:1 on --color-ink)
     for the brand hue used directly as text/icon color. Distinct from
     --color-gold (vivid orange-red vs. gold's paler yellow) so brand
     actions and gold accents (badges, premium markers) stay visually
     separable. */
  --color-brand: #FF5C1A;
  --color-brand-ink: #F68355;
  --color-brand-deep: #C23700;
  --color-gold: #E8B84B;
```

- [ ] **Step 20: Repoint the remaining text-coin consumers to text-gold**

In `apps/flick-app/src/app/(app)/home/HomeClient.tsx`, change:

```tsx
              <span className="text-[11px] font-medium tracking-wide text-coin">แนะนำวันนี้</span>
```

to:

```tsx
              <span className="text-[11px] font-medium tracking-wide text-gold">แนะนำวันนี้</span>
```

In `apps/flick-app/src/app/LandingClient.tsx`, change:

```tsx
              <span className="absolute top-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium tracking-wide text-coin backdrop-blur-sm">
```

to:

```tsx
              <span className="absolute top-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium tracking-wide text-gold backdrop-blur-sm">
```

(`DiscoverClient.tsx` and `SubscribeClient.tsx` were already repointed to
`text-gold`/`bg-gold` in Steps 6 and 11 above.)

- [ ] **Step 21: Update usePlaybackAuthorization.test.tsx**

The existing test in
`apps/flick-app/src/features/playback/hooks/usePlaybackAuthorization.test.tsx`
does not reference `unlockWithCoins`, `coinCost`, or `'coins_required'` —
confirm it still compiles and passes as-is (it uses only `allowed: true,
reason: 'free'`, both of which survive unchanged).

- [ ] **Step 22: Full verification**

Run: `cd apps/flick-app && npm test && npm run lint && npm run build`
Expected: all green. Specifically confirm zero remaining matches:

Run: `cd apps/flick-app && grep -rn "coinCost\|coinBalance\|CoinPack\|WalletResponse\|coins_required\|'unlocked'\|text-coin\|bg-coin\|COIN_PACK\|unlockWithCoins\|baselineBalance" src`
Expected: no output.

- [ ] **Step 23: Commit**

```bash
git add -A apps/flick-app/src
git commit -m "feat(app): remove the coin economy from the frontend

The gate sheet collapses to a single subscription-required branch —
the inline plan comparison built for that case is now the only
paywall UI. checkGranted drops its COIN_PACK branch; the itemType===
null recovery branch survives, reduced to the subscription signal
only. --color-coin is renamed to --color-gold rather than deleted —
four of its eleven consumers are unrelated gold accents, including
the plan badge that survives on the 249 card. MovieClient's episode
lock badge now reads off isPremium instead of a coin cost."
```

---

## Task 9: Full-repo verification and the manual funnel re-check

**Files:** none modified — this task is verification only.

**Interfaces:**
- Consumes: everything in Tasks 1-8.
- Produces: a green baseline confirming the coin removal did not regress
  the return-to-intent spine (the gate sheet and checkout-return path both
  changed in Task 8, and that funnel is exactly what this walkthrough
  covers).

**Context:** Task 15 of the return-to-intent plan already walked this same
funnel by hand on 28 Aug — logged-out deep link, paid checkout return, and
the two open-redirect break attempts. Two of those three legs pass directly
through code this plan just rewrote (the gate sheet, `checkGranted`), so
re-running them is the real regression check, not a formality.

- [ ] **Step 1: Run every suite**

```bash
cd apps/flick-app && npm test && npm run lint && npm run build
cd ../flick-api && npm test && npm run lint && npm run test:e2e
```

Expected: all green. The API e2e needs a seeded local database — if
`otp_challenges` or the seeded `e2e-free-user` are missing, run
`npx prisma migrate deploy` then `npm run db:seed` first.

- [ ] **Step 2: Walk the funnel by hand, logged out**

1. Open `/player/sathu-premium` while logged out.
2. Confirm the URL becomes `/login?next=%2Fplayer%2Fsathu-premium`.
3. Complete the OTP flow with the seeded phone `+66800000001`.
4. Confirm you land back on that episode, not `/home`.
5. Confirm the gate sheet reads "สมัครสมาชิกเพื่อรับชม" and lists a single
   ฿249 monthly plan (no coin pack section, no balance arithmetic).

- [ ] **Step 3: Walk the paid path**

1. As the same user (no active subscription — clear it first via
   `DELETE FROM subscriptions WHERE "userId" = '<seeded user id>'` if a
   prior run left one), open `sathu-premium` again.
2. From the gate sheet, tap `ดูแพ็กเกจสมาชิก`.
3. Confirm `/subscribe?next=%2Fplayer%2Fsathu-premium`.
4. Confirm `/subscribe` shows exactly two cards: ฟรี and VIP รายเดือน at
   ฿249 — no weekly card, no coin pack row beneath the plans.
5. Complete a checkout against the fake gateway (simulate the webhook
   directly per the pattern established in Task 6's e2e tests, since
   `fake-gateway.local` does not resolve in a real browser).
6. Confirm the processing screen returns you to `sathu-premium`.

- [ ] **Step 4: Try to break it**

Open `/login?next=https://evil.com` and `/login?next=//evil.com`, complete a
login, and confirm you land on `/home` both times — never off-origin. (This
path does not touch anything Task 8 changed, but it is cheap to re-confirm
alongside the rest of this walkthrough.)

- [ ] **Step 5: Confirm no coin surface remains in the running app**

1. Visit `/profile` — confirm there is no "เหรียญคงเหลือ" card.
2. Visit the header on any `(app)` route — confirm there is no coin balance
   pill next to the search/downloads icons.
3. Visit `/movie/<any movie with a premium episode>` — confirm the premium
   episode shows a "พรีเมียม" badge with a lock icon, not a coin count.

- [ ] **Step 6: Commit the verification record**

```bash
git commit --allow-empty -m "docs: record verification of the coin-economy removal

Both suites green (flick-app: test+lint+build; flick-api:
test+lint+e2e). Manual funnel re-walked end to end: logged-out deep
link -> OTP -> back to episode; gate -> /subscribe (single 249/month
plan, no coin section) -> checkout -> processing screen returns to
episode; both open-redirect break attempts still land on /home. No
coin balance, coin pack, or coin cost surface remains anywhere in the
running app."
```
