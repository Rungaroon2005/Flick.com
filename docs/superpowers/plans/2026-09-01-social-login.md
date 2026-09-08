# Social Login Implementation Plan — Google and Apple

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person sign in with Google or Apple from the login screen and land
in the same session an OTP login produces, with identity moved off the `User` row
so a further provider costs one adapter.

**Architecture:** Client-side token flow. The browser runs Google One Tap and
Sign in with Apple JS, receives an `id_token`, and posts it to a single
`POST /auth/oauth/verify`. The backend consumes a server-issued single-use nonce,
verifies the token against the provider's JWKS, and hands a provider-agnostic
`ProviderProfile` to `IdentityResolver`, which mints the existing `access_token`
cookie. There is no server-side redirect and no authorization-code exchange.

**Tech Stack:** NestJS 11, Prisma 7.9 (PostgreSQL), `jose` for token
verification, `@nestjs/schedule` for pruning, jest for the API, Next.js 16 +
vitest for the frontend, provider-hosted SDK scripts via `next/script`.

**Spec:** `docs/superpowers/specs/2026-09-01-social-login-design.md` — read it
first, including §0, which records why the earlier server-side redirect design
was discarded.

## Global Constraints

Every task's requirements implicitly include this section.

- **Two new dependencies, both in `apps/flick-api`: `jose` and `@nestjs/schedule`**
  (spec §9.1). **The frontend adds no npm dependency** — both SDKs are
  provider-hosted scripts loaded with `next/script`.
- **The session is not redesigned.** Social login mints the *existing* cookie via
  the existing `setTokenCookie` (`auth.controller.ts:38-46`) and the existing
  payload `{ sub: user.id, email: user.email }`. `JwtStrategy`, `JwtAuthGuard`,
  `RolesGuard` and the frontend's `getSession()` must not change.
- **The token never appears in a response body.** `AuthController.verifyOtp`
  already strips it (`auth.controller.ts:74-76`); `/verify` does the same.
- **Never auto-link on an unverified provider email** (spec §6.2 row 2). This is
  the assertion the feature's safety rests on.
- **Never write `User.email` without proof of control** (spec §11.1). Set
  `emailVerifiedAt` in the same statement, or leave the email null.
- **`displayName` from the request body is a hint, never an identity.** Apple
  sends the name beside the token, not inside it (spec §8.3), so it is
  caller-supplied and unverified. It may fill a display name and nothing else.
- **All UI copy is Thai.** New strings are given verbatim; do not translate or
  reword them.
- **`apps/flick-api` currently has 179 passing tests; `apps/flick-app` has 89.**
  Both numbers only go up.
- **Per-task gate, run before every commit:**
  ```bash
  cd apps/flick-api && npm test && npm run lint
  cd ../flick-app && npm test && npm run lint
  ```

---

## File Structure

API paths relative to `apps/flick-api/src/`.

| File | Change | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | `Identity`, `OAuthNonce`, `IdentityProvider`, `User.emailVerifiedAt` |
| `prisma/migrations/<ts>_social_login/migration.sql` | Create | Tables + the email backfill |
| `testing/prisma.mock.ts` | Modify | Adds `identity` and `oAuthNonce` mocks |
| `auth/oauth/oauth-provider.port.ts` | Create | `OAuthProviderPort`, `ProviderProfile`, DI token |
| `auth/oauth/adapters/fake-provider.adapter.ts` | Create | Deterministic adapter for tests and e2e |
| `auth/oauth/adapters/google-provider.adapter.ts` | Create | Google JWKS + claim mapping |
| `auth/oauth/adapters/apple-provider.adapter.ts` | Create | Apple JWKS + claim mapping |
| `auth/oauth/oauth-nonce.service.ts` | Create | Issue and single-use consume |
| `auth/oauth/identity-resolver.ts` | Create | The spec §6.2 decision table |
| `auth/oauth/dto/verify-oauth.dto.ts` | Create | Request contract for `/verify` |
| `auth/oauth/oauth.controller.ts` | Create | `/providers`, `/nonce`, `/verify` |
| `auth/oauth/oauth.module.ts` | Create | Provider registry from config |
| `common/config.validation.ts` | Modify | Fail closed on a half-configured provider |
| `maintenance/prune.service.ts` | Create | The scheduled reaper (spec §9) |
| `app.module.ts` | Modify | Register `OAuthModule`, `ScheduleModule`, `MaintenanceModule` |

Frontend paths relative to `apps/flick-app/src/`.

| File | Change | Responsibility |
|---|---|---|
| `types/api.ts` | Modify | Three new paths in `ApiPath`, `ApiResponse`, `decodeApiResponse` |
| `features/auth/oauth.ts` | Create | `fetchOAuthProviders`, `requestNonce`, `verifyOAuth` |
| `features/auth/useGoogleSignIn.ts` | Create | Loads GSI, renders the button, hands back a credential |
| `features/auth/useAppleSignIn.ts` | Create | Loads Apple JS, popup sign-in |
| `app/login/page.tsx` | Modify | Both buttons, the §6.3 conflict message |

### Component checklist

- [ ] Schema + migration + backfill + prisma mock (Task 1)
- [ ] `OAuthProviderPort` / `ProviderProfile` / fake adapter (Task 2)
- [ ] `OAuthNonceService` (Task 3)
- [ ] `IdentityResolver` — the §6.2 table (Task 4)
- [ ] `IdentityResolver` concurrency — P2002 as a retry signal (Task 5)
- [ ] `GoogleProviderAdapter` (Task 6)
- [ ] `AppleProviderAdapter` (Task 7)
- [ ] Registry, module wiring, config validation (Task 8)
- [ ] `/providers`, `/nonce`, `/verify` + e2e (Task 9)
- [ ] Frontend client + API contract (Task 10)
- [ ] Login screen: both buttons + conflict copy (Task 11)
- [ ] Scheduled reaper (Task 12)
- [ ] Whole-pass verification (Task 13)

---

## Task 1: Schema, migration, and the email backfill

**Files:**
- Modify: `apps/flick-api/prisma/schema.prisma`
- Create: `apps/flick-api/prisma/migrations/<timestamp>_social_login/migration.sql`
- Modify: `apps/flick-api/src/testing/prisma.mock.ts`

**Interfaces:**
- Produces: Prisma models `Identity`, `OAuthNonce`; enum `IdentityProvider`;
  `User.emailVerifiedAt`. Client accessors are **`prisma.identity`** and
  **`prisma.oAuthNonce`** — Prisma lowercases only the first character, so
  `OAuthNonce` becomes `oAuthNonce`, not `oauthNonce`. Later tasks use those
  exact names.

**Context:** Spec §4. Additive: two tables, one enum, one nullable column. The
backfill is the one piece of data work, and skipping it sends every existing
email user into the §6.3 refusal on their first social sign-in.

- [ ] **Step 1: Add the models**

In `apps/flick-api/prisma/schema.prisma`, add the enum beside the other enums:

```prisma
enum IdentityProvider {
  GOOGLE
  APPLE
}
```

Add to `model User`, after `isVerified`:

```prisma
  /// Set once ANY channel has proven control of User.email — OTP delivery, or a
  /// provider asserting email_verified. Distinct from `isVerified`, which means
  /// "proved control of their login destination", whatever that was.
  emailVerifiedAt DateTime?
```

and to its relation list, beside `subscriptions`:

```prisma
  identities Identity[]
```

Then both models:

```prisma
model Identity {
  id       String           @id @default(uuid())
  userId   String
  provider IdentityProvider

  /// The provider's stable, immutable subject id (OIDC `sub`). NEVER the email:
  /// providers let users change their email, and Apple's may be a relay address.
  providerAccountId String

  /// What the provider asserted AT LINK TIME, kept for audit. Not a source of
  /// truth for login — User.email is.
  email         String?
  emailVerified Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// The login key, and the race guard: concurrent first verifications collide
  /// here rather than creating two users. See Task 5.
  @@unique([provider, providerAccountId])
  /// One identity per provider per user; stops a retry accumulating duplicates.
  @@unique([userId, provider])
  @@index([userId])
  @@map("identities")
}

model OAuthNonce {
  id       String           @id @default(uuid())
  /// Random, single-use. Handed to the SDK, echoed inside the signed id_token.
  /// Server-issued on purpose: a client-invented nonce proves nothing, because
  /// the server cannot tell a fresh one from one an attacker reused.
  nonce    String           @unique
  provider IdentityProvider

  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  consumedAt DateTime?

  @@index([expiresAt])
  @@map("oauth_nonces")
}
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/flick-api && npx prisma migrate dev --name social_login --create-only
```

`--create-only` writes the SQL without applying it, so Step 3 can add the
backfill before anything runs.

- [ ] **Step 3: Append the backfill**

At the end of the generated
`prisma/migrations/<timestamp>_social_login/migration.sql`:

```sql
-- Every existing users.email was proven by OTP delivery: the only write is in
-- OtpService.verify, reachable only by receiving a code at that address. This
-- states that existing fact rather than asserting a new one. Without it, every
-- current email user would hit the refuse-to-auto-link branch on their first
-- social sign-in.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "email" IS NOT NULL;
```

- [ ] **Step 4: Apply and regenerate**

```bash
cd apps/flick-api && npx prisma migrate dev && npx prisma generate
```

Expected: migration applies; client exposes `IdentityProvider`,
`prisma.identity`, `prisma.oAuthNonce`.

- [ ] **Step 5: Extend the prisma mock**

In `apps/flick-api/src/testing/prisma.mock.ts`, add to the `PrismaMock`
interface, beside `otpChallenge`:

```typescript
  identity: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  oAuthNonce: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
```

and to the object `createPrismaMock` returns:

```typescript
    identity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    oAuthNonce: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
```

- [ ] **Step 6: Verify nothing regressed**

```bash
cd apps/flick-api && npm test && npm run lint
```

Expected: 179 passing, unchanged. This task adds no behaviour and no tests; the
migration is exercised by CI's `migrate:deploy`.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/prisma/schema.prisma apps/flick-api/prisma/migrations \
        apps/flick-api/src/testing/prisma.mock.ts
git commit -m "feat(auth): add Identity and OAuthNonce models

Moves identity off the User row: a User becomes a profile and an
entitlement holder, and Identity rows say how that person can prove they
are themselves. OAuthNonce holds a single-use, server-issued nonce that
the provider SDK embeds in the signed id_token -- without it the
verification endpoint would accept a captured token for its full lifetime,
and a client-invented nonce would prove nothing.

The migration backfills emailVerifiedAt from createdAt for every existing
email. That states an existing fact -- the only write of User.email is
inside OtpService.verify, reachable only by receiving a code at that
address -- and without it every current email user would hit the
refuse-to-auto-link branch on their first social sign-in."
```

---

## Task 2: The provider port and a fake adapter

**Files:**
- Create: `apps/flick-api/src/auth/oauth/oauth-provider.port.ts`
- Create: `apps/flick-api/src/auth/oauth/adapters/fake-provider.adapter.ts`
- Test: `apps/flick-api/src/auth/oauth/adapters/fake-provider.adapter.spec.ts`

**Interfaces:**
- Produces:
  ```typescript
  export const OAUTH_PROVIDER_REGISTRY = 'OAUTH_PROVIDER_REGISTRY';
  export interface ProviderProfile {
    providerAccountId: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string | null;
    avatarUrl: string | null;
  }
  export interface OAuthProviderPort {
    readonly id: IdentityProvider;
    verifyIdToken(idToken: string, expectedNonce: string): Promise<ProviderProfile>;
  }
  export type OAuthProviderRegistry = Map<IdentityProvider, OAuthProviderPort>;
  ```
  Tasks 4-11 depend on these names exactly.

**Context:** Spec §5. `ProviderProfile` is the only shape the resolver sees,
which is what keeps Apple's quirks out of the linking logic. The fake adapter
lets Tasks 4-9 be built and e2e-tested before any provider credential exists —
the role `FakeGatewayAdapter` plays for payments.

- [ ] **Step 1: Write the port**

Create `apps/flick-api/src/auth/oauth/oauth-provider.port.ts`:

```typescript
import { IdentityProvider } from '@prisma/client';

/** DI token for the provider registry. */
export const OAUTH_PROVIDER_REGISTRY = 'OAUTH_PROVIDER_REGISTRY';

/**
 * The ONLY shape IdentityResolver ever sees. No provider-specific field may be
 * added here: the moment the resolver can tell Google from Apple, the linking
 * rules start growing per-provider branches.
 */
export interface ProviderProfile {
  /** The provider's stable subject id. Never an email. */
  providerAccountId: string;
  email: string | null;
  /** A real boolean. Apple sends the STRING "true"; adapters must parse it. */
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OAuthProviderPort {
  readonly id: IdentityProvider;
  /**
   * Verifies signature against the provider's JWKS, plus iss, aud, exp, and
   * that the token's nonce equals `expectedNonce`. Rejects otherwise. A
   * well-signed token issued for a different application is not a login.
   */
  verifyIdToken(idToken: string, expectedNonce: string): Promise<ProviderProfile>;
}

/** provider id → adapter. A provider absent here is not configured. */
export type OAuthProviderRegistry = Map<IdentityProvider, OAuthProviderPort>;
```

- [ ] **Step 2: Write the failing test**

Create `apps/flick-api/src/auth/oauth/adapters/fake-provider.adapter.spec.ts`:

```typescript
import { IdentityProvider } from '@prisma/client';
import { FakeOAuthProviderAdapter } from './fake-provider.adapter';

describe('FakeOAuthProviderAdapter', () => {
  const adapter = new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE);

  const profile = {
    providerAccountId: 'sub_1',
    email: 'a@example.com',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: null,
  };

  it('decodes a profile from the token so tests can choose one', async () => {
    const token = FakeOAuthProviderAdapter.mint(profile, 'nonce_1');

    await expect(adapter.verifyIdToken(token, 'nonce_1')).resolves.toEqual(profile);
  });

  it('rejects a token whose nonce does not match the one we issued', async () => {
    const token = FakeOAuthProviderAdapter.mint(profile, 'nonce_1');

    // The replay guard. A captured token carries the nonce it was minted with.
    await expect(adapter.verifyIdToken(token, 'nonce_2')).rejects.toThrow(/nonce/i);
  });

  it('rejects a token it did not mint', async () => {
    await expect(adapter.verifyIdToken('garbage', 'nonce_1')).rejects.toThrow(
      /invalid token/i,
    );
  });
});
```

- [ ] **Step 3: Run it to watch it fail**

```bash
cd apps/flick-api && npx jest fake-provider.adapter.spec
```

Expected: FAIL — `Cannot find module './fake-provider.adapter'`.

- [ ] **Step 4: Write the adapter**

Create `apps/flick-api/src/auth/oauth/adapters/fake-provider.adapter.ts`:

```typescript
import { IdentityProvider } from '@prisma/client';
import type { OAuthProviderPort, ProviderProfile } from '../oauth-provider.port';

/**
 * Deterministic provider for tests and e2e, mirroring FakeGatewayAdapter's role
 * in payments: it lets the whole verification path be exercised without a
 * network call or a real credential. The token IS the profile plus the nonce,
 * base64url-encoded, so a test can drive any linking branch and can prove the
 * nonce check fires.
 *
 * config.validation.ts refuses to let this be selected in production.
 */
export class FakeOAuthProviderAdapter implements OAuthProviderPort {
  constructor(readonly id: IdentityProvider) {}

  static mint(profile: ProviderProfile, nonce: string): string {
    return Buffer.from(JSON.stringify({ profile, nonce }), 'utf8').toString(
      'base64url',
    );
  }

  verifyIdToken(idToken: string, expectedNonce: string): Promise<ProviderProfile> {
    let decoded: { profile?: ProviderProfile; nonce?: string };
    try {
      decoded = JSON.parse(
        Buffer.from(idToken, 'base64url').toString('utf8'),
      ) as { profile?: ProviderProfile; nonce?: string };
    } catch {
      return Promise.reject(new Error('Fake provider: invalid token'));
    }

    if (!decoded?.profile?.providerAccountId) {
      return Promise.reject(new Error('Fake provider: invalid token'));
    }
    if (decoded.nonce !== expectedNonce) {
      return Promise.reject(new Error('Fake provider: nonce mismatch'));
    }
    return Promise.resolve(decoded.profile);
  }
}
```

- [ ] **Step 5: Run it to watch it pass**

```bash
cd apps/flick-api && npx jest fake-provider.adapter.spec
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/oauth/
git commit -m "feat(auth): add the OAuth provider port and a fake adapter

One method: verify an id_token against an expected nonce and return a
ProviderProfile. That profile is the only shape IdentityResolver will ever
see, which is what keeps a provider's quirks -- Apple's string
email_verified, its relay addresses -- out of the linking rules.

The fake adapter mints the profile and nonce into the token itself, so
every branch of the resolver and the whole verification path can be driven
in tests before a provider credential exists, and the nonce check has a
test that fails if it is ever dropped."
```

---

## Task 3: `OAuthNonceService`

**Files:**
- Create: `apps/flick-api/src/auth/oauth/oauth-nonce.service.ts`
- Test: `apps/flick-api/src/auth/oauth/oauth-nonce.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.oAuthNonce` (Task 1).
- Produces:
  ```typescript
  export const OAUTH_NONCE_TTL_MS = 5 * 60 * 1000;
  class OAuthNonceService {
    issue(provider: IdentityProvider): Promise<{ nonce: string; expiresIn: number }>
    consume(nonce: string, provider: IdentityProvider): Promise<void>
  }
  ```
  `consume` throws `BadRequestException` for unknown, expired, wrong-provider or
  already-consumed nonces.

**Context:** Spec §4.3. Single-use via a `consumedAt` guard, exactly as
`OtpService.verify` burns a challenge (`otp.service.ts:273-279`): the guarded
`updateMany` matching zero rows *is* the replay detection, because a
read-then-write check would race. Five minutes is ample — the user is mid-popup.

- [ ] **Step 1: Write the failing tests**

Create `apps/flick-api/src/auth/oauth/oauth-nonce.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { OAuthNonceService } from './oauth-nonce.service';
import { PrismaService } from '../../prisma.service';
import { createPrismaMock } from '../../testing/prisma.mock';

describe('OAuthNonceService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: OAuthNonceService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.oAuthNonce.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'on_1', ...args.data }),
    );
    service = new OAuthNonceService(prisma as unknown as PrismaService);
  });

  const live = (overrides = {}) => ({
    id: 'on_1',
    nonce: 'n_1',
    provider: IdentityProvider.GOOGLE,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  });

  it('issues an unguessable nonce and stores it against the provider', async () => {
    const issued = await service.issue(IdentityProvider.APPLE);

    expect(issued.nonce.length).toBeGreaterThanOrEqual(32);
    expect(issued.expiresIn).toBeGreaterThan(0);

    const created = prisma.oAuthNonce.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.provider).toBe(IdentityProvider.APPLE);
    expect(created.data.nonce).toBe(issued.nonce);
  });

  it('consumes a live nonce exactly once', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(live());
    prisma.oAuthNonce.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).resolves.toBeUndefined();
  });

  it('rejects a replay whose consuming update matches zero rows', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(live());
    // A concurrent request burned it between our read and our write.
    prisma.oAuthNonce.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an already-consumed nonce without touching the row', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(
      live({ consumedAt: new Date() }),
    );

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.oAuthNonce.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired nonce', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(
      live({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a nonce issued for a different provider', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(
      live({ provider: IdentityProvider.APPLE }),
    );

    // Otherwise an Apple nonce could be spent on a Google token.
    await expect(
      service.consume('n_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown nonce', async () => {
    prisma.oAuthNonce.findUnique.mockResolvedValue(null);

    await expect(
      service.consume('nope', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest oauth-nonce.service.spec
```

Expected: FAIL — `Cannot find module './oauth-nonce.service'`.

- [ ] **Step 3: Write the service**

Create `apps/flick-api/src/auth/oauth/oauth-nonce.service.ts`:

```typescript
import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/** The user is mid-popup; five minutes is generous. */
export const OAUTH_NONCE_TTL_MS = 5 * 60 * 1000;

/** One message for every failure: unknown, expired, wrong provider, replayed. */
const INVALID_NONCE =
  'คำขอเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ (Invalid or expired login request)';

@Injectable()
export class OAuthNonceService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    provider: IdentityProvider,
  ): Promise<{ nonce: string; expiresIn: number }> {
    const nonce = randomBytes(32).toString('base64url');

    await this.prisma.oAuthNonce.create({
      data: {
        nonce,
        provider,
        expiresAt: new Date(Date.now() + OAUTH_NONCE_TTL_MS),
      },
    });

    return { nonce, expiresIn: Math.floor(OAUTH_NONCE_TTL_MS / 1000) };
  }

  /**
   * Burns the nonce. The guarded updateMany IS the single-use mechanism: two
   * concurrent requests both read a live row, and the second matches zero rows
   * once the first commits. A read-then-write check would race. Same pattern as
   * OtpService.verify.
   */
  async consume(nonce: string, provider: IdentityProvider): Promise<void> {
    const row = await this.prisma.oAuthNonce.findUnique({ where: { nonce } });

    if (
      !row ||
      row.provider !== provider ||
      row.consumedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(INVALID_NONCE);
    }

    const burned = await this.prisma.oAuthNonce.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (burned.count === 0) throw new BadRequestException(INVALID_NONCE);
  }
}
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest oauth-nonce.service.spec
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/oauth/oauth-nonce.service.ts \
        apps/flick-api/src/auth/oauth/oauth-nonce.service.spec.ts
git commit -m "feat(auth): issue single-use nonces for social sign-in

Without a server-issued nonce the verification endpoint accepts any
well-formed id_token for its full lifetime, so one captured from a log,
an extension or an XSS can be replayed into a session. Both provider SDKs
embed a nonce in the signed token, and only a value the server minted and
can burn exactly once closes the window -- a client-invented nonce proves
nothing.

Single-use is enforced by a guarded updateMany on consumedAt: null. Two
concurrent requests both read a live row and the second matches zero rows,
the same mechanism OtpService.verify uses to burn a challenge. A nonce is
also bound to its provider, so an Apple nonce cannot be spent on a Google
token. One identical message for every failure mode."
```

---

## Task 4: `IdentityResolver` — the linking rules

**Files:**
- Create: `apps/flick-api/src/auth/oauth/identity-resolver.ts`
- Test: `apps/flick-api/src/auth/oauth/identity-resolver.spec.ts`

**Interfaces:**
- Consumes: `ProviderProfile` (Task 2), `prisma.identity` / `prisma.user` (Task 1).
- Produces:
  ```typescript
  export const EMAIL_CLAIMED: string;
  export interface ResolvedIdentity {
    userId: string; isNewUser: boolean; linked: boolean;
  }
  class IdentityResolver {
    resolve(provider: IdentityProvider, profile: ProviderProfile): Promise<ResolvedIdentity>
  }
  ```
  Throws `ConflictException` for the §6.3 refusal and `UnauthorizedException`
  for a soft-deleted user. Task 9 consumes both.

**Context:** Spec §6.1 and §6.2. This is where the feature's security lives, so
it is a pure decision over a `ProviderProfile` with no HTTP anywhere and it gets
the densest test file in the change. Every row of the §6.2 table is a test.

- [ ] **Step 1: Write the failing tests**

Create `apps/flick-api/src/auth/oauth/identity-resolver.spec.ts`:

```typescript
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { IdentityResolver } from './identity-resolver';
import { PrismaService } from '../../prisma.service';
import { createPrismaMock } from '../../testing/prisma.mock';
import type { ProviderProfile } from './oauth-provider.port';

describe('IdentityResolver', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let resolver: IdentityResolver;

  const profile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
    providerAccountId: 'sub_1',
    email: 'a@example.com',
    emailVerified: true,
    displayName: 'Somchai',
    avatarUrl: null,
    ...overrides,
  });

  const resolve = (p: ProviderProfile = profile()) =>
    resolver.resolve(IdentityProvider.GOOGLE, p);

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.user.create.mockResolvedValue({ id: 'u_new' });
    prisma.identity.create.mockResolvedValue({ id: 'i_1' });
    resolver = new IdentityResolver(prisma as unknown as PrismaService);
  });

  it('logs in a returning user by provider account id', async () => {
    prisma.identity.findUnique.mockResolvedValue({
      id: 'i_1',
      userId: 'u1',
      user: { id: 'u1', deletedAt: null },
    });

    await expect(resolve()).resolves.toEqual({
      userId: 'u1',
      isNewUser: false,
      linked: false,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses a returning user whose account was deleted', async () => {
    prisma.identity.findUnique.mockResolvedValue({
      id: 'i_1',
      userId: 'u1',
      user: { id: 'u1', deletedAt: new Date() },
    });

    await expect(resolve()).rejects.toThrow(UnauthorizedException);
  });

  // --- spec §6.2, row by row -------------------------------------------

  it('row 1: creates an emailless user when the provider gives no email', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);

    await expect(resolve(profile({ email: null }))).resolves.toMatchObject({
      isNewUser: true,
    });

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.email).toBeNull();
    expect(created.data.emailVerifiedAt).toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('row 2: NEVER links on an unverified provider email', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);

    // The takeover: an attacker registers the victim's address at a provider
    // that does not verify it. We must not even look for a matching user.
    await expect(
      resolve(profile({ emailVerified: false })),
    ).resolves.toMatchObject({ isNewUser: true, linked: false });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.email).toBeNull();
  });

  it('row 3: creates a verified-email user when no account matches', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(resolve()).resolves.toMatchObject({ isNewUser: true });

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.email).toBe('a@example.com');
    expect(created.data.emailVerifiedAt).toEqual(expect.any(Date));
  });

  it('row 4: auto-links a verified provider email to a verified local account', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u_existing',
      emailVerifiedAt: new Date('2026-01-01'),
    });

    await expect(resolve()).resolves.toEqual({
      userId: 'u_existing',
      isNewUser: false,
      linked: true,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();

    const identity = prisma.identity.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(identity.data.userId).toBe('u_existing');
    expect(identity.data.providerAccountId).toBe('sub_1');
  });

  it('row 5: refuses to link to an account whose email was never proven', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u_unproven',
      emailVerifiedAt: null,
    });

    // Pre-hijacking: someone claimed this address locally without proving it.
    // Linking would log the real owner into the squatter's account.
    await expect(resolve()).rejects.toThrow(ConflictException);
    expect(prisma.identity.create).not.toHaveBeenCalled();
  });

  it('falls back to a display name when the provider gives none', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);

    await resolve(profile({ displayName: null }));

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.displayName).toEqual(expect.any(String));
    expect(String(created.data.displayName).length).toBeGreaterThan(0);
  });

  it('records what the provider asserted, for audit', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);

    await resolve();

    const identity = prisma.identity.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(identity.data.email).toBe('a@example.com');
    expect(identity.data.emailVerified).toBe(true);
    expect(identity.data.provider).toBe(IdentityProvider.GOOGLE);
  });
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest identity-resolver.spec
```

Expected: FAIL — `Cannot find module './identity-resolver'`.

- [ ] **Step 3: Write the resolver**

Create `apps/flick-api/src/auth/oauth/identity-resolver.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { ProviderProfile } from './oauth-provider.port';

type Tx = Prisma.TransactionClient;

export interface ResolvedIdentity {
  userId: string;
  isNewUser: boolean;
  linked: boolean;
}

/**
 * Shown when a provider-verified email matches a local account whose own email
 * was never proven. See the design spec §6.3: this should be unreachable after
 * the migration backfill, and every occurrence is logged at ERROR.
 *
 * Deliberately says "an account", never "your account".
 */
export const EMAIL_CLAIMED =
  'มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์';

/**
 * Answers "which user is this provider account?" — the whole security surface of
 * social login, deliberately kept as a decision over a ProviderProfile with no
 * HTTP, no provider knowledge and no framework in sight.
 */
@Injectable()
export class IdentityResolver {
  private readonly logger = new Logger(IdentityResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    provider: IdentityProvider,
    profile: ProviderProfile,
  ): Promise<ResolvedIdentity> {
    // 1. Known provider account: the common path.
    const existing = await this.prisma.identity.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (existing) {
      if (existing.user.deletedAt) throw new UnauthorizedException();
      return { userId: existing.userId, isNewUser: false, linked: false };
    }

    // 2. No usable email: nothing to match on, so this is a new person. An
    //    UNVERIFIED email lands here too, and that is the point — matching on
    //    one would hand over an account to whoever registered the address at a
    //    provider that does not check it.
    if (!profile.email || !profile.emailVerified) {
      return this.createUser(provider, profile, null);
    }

    // 3. Verified email, no local match: new person, email trusted.
    const claimant = await this.prisma.user.findFirst({
      where: { email: profile.email, deletedAt: null },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!claimant) {
      return this.createUser(provider, profile, profile.email);
    }

    // 4. Local account exists but never proved this address. Linking would log
    //    the address's real owner into someone else's account.
    if (claimant.emailVerifiedAt === null) {
      this.logger.error(
        `Refused to auto-link ${provider} identity to user ${claimant.id}: ` +
          `local email was never verified. This should be unreachable — see ` +
          `docs/superpowers/specs/2026-09-01-social-login-design.md §6.3.`,
      );
      throw new ConflictException(EMAIL_CLAIMED);
    }

    // 5. Both sides proved the same address. Link.
    await this.prisma.identity.create({
      data: this.identityData(provider, profile, claimant.id),
    });
    return { userId: claimant.id, isNewUser: false, linked: true };
  }

  /** User and identity in ONE transaction: an account with no way to sign in is
   *  worse than no account. */
  private async createUser(
    provider: IdentityProvider,
    profile: ProviderProfile,
    email: string | null,
  ): Promise<ResolvedIdentity> {
    const userId = await this.prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.create({
        data: {
          email,
          // Never a timestamp without an email: the two must agree.
          emailVerifiedAt: email ? new Date() : null,
          displayName: displayNameFor(profile),
          isVerified: true,
        },
        select: { id: true },
      });
      await tx.identity.create({
        data: this.identityData(provider, profile, user.id),
      });
      return user.id;
    });

    return { userId, isNewUser: true, linked: false };
  }

  private identityData(
    provider: IdentityProvider,
    profile: ProviderProfile,
    userId: string,
  ) {
    return {
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      emailVerified: profile.emailVerified,
    };
  }
}

/** Providers do not reliably send a name — Apple sends it once, ever. */
function displayNameFor(profile: ProviderProfile): string {
  if (profile.displayName && profile.displayName.trim().length > 0) {
    return profile.displayName.trim();
  }
  if (profile.email) return profile.email.split('@')[0];
  return `ผู้ใช้${profile.providerAccountId.slice(-4)}`;
}
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest identity-resolver.spec
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/oauth/identity-resolver.ts \
        apps/flick-api/src/auth/oauth/identity-resolver.spec.ts
git commit -m "feat(auth): resolve a provider account to a user

The whole security surface of social login, kept as a decision over a
ProviderProfile with no HTTP and no provider knowledge, with a test per row
of the spec's linking table.

Two rules carry it. An unverified provider email is never matched against
an existing account -- otherwise registering the victim's address at a
provider that does not check it hands over their account. And a verified
provider email is not linked to a local account whose own email was never
proven, because that would log the address's real owner into a squatter's
account. The second branch should be unreachable after the migration
backfill, so it logs at ERROR: a hit means an invariant broke."
```

---

## Task 5: Concurrency — `P2002` is a retry signal, not an error

**Files:**
- Modify: `apps/flick-api/src/auth/oauth/identity-resolver.ts`
- Test: `apps/flick-api/src/auth/oauth/identity-resolver.spec.ts`

**Interfaces:**
- Consumes: `IdentityResolver.resolve` (Task 4). No signature change.

**Context:** Spec §7. Two verifications can arrive concurrently for one
`providerAccountId` — a double-clicked button, or two tabs. **The transaction in
Task 4 does not prevent the duplicate** — under READ COMMITTED both reads see no
identity and both insert. `@@unique([provider, providerAccountId])` is what
serializes them: one wins, the other raises `P2002`. The loser must re-read and
succeed.

The `P2002` catch must be narrowed to that one constraint. A blanket catch is the
exact defect the 2026-09-01 review found in `PaymentsService` and
`2026-09-01-security-hardening.md` Task 3 repairs. Do not reintroduce it.

- [ ] **Step 1: Write the failing tests**

Add to `apps/flick-api/src/auth/oauth/identity-resolver.spec.ts`, adding `Prisma`
to the `@prisma/client` import:

```typescript
  const uniqueViolation = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it('treats a concurrent first verification as a login, not an error', async () => {
    // Both requests read "no identity"; the other one won the insert.
    prisma.identity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'i_1',
        userId: 'u_winner',
        user: { id: 'u_winner', deletedAt: null },
      });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValueOnce(
      uniqueViolation(['provider', 'providerAccountId']),
    );

    await expect(resolve()).resolves.toEqual({
      userId: 'u_winner',
      isNewUser: false,
      linked: false,
    });
  });

  it('rethrows a unique violation on a different constraint', async () => {
    prisma.identity.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    // Two people, one email. Swallowing this as a "concurrent login" would
    // resolve to whatever identity happened to exist.
    prisma.$transaction.mockRejectedValueOnce(uniqueViolation(['email']));

    await expect(resolve()).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('does not loop forever if the winner cannot be found', async () => {
    prisma.identity.findUnique.mockResolvedValue(null); // never appears
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(
      uniqueViolation(['provider', 'providerAccountId']),
    );

    await expect(resolve()).rejects.toThrow();
  });
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest identity-resolver.spec -t "concurrent"
```

Expected: FAIL — the P2002 escapes `resolve` instead of being retried.

- [ ] **Step 3: Add the retry**

In `apps/flick-api/src/auth/oauth/identity-resolver.ts`, add above the class:

```typescript
/**
 * Which unique constraint means "a concurrent verification for this same
 * provider account beat us to it"? Only the identity key. Matched by substring
 * because Prisma reports meta.target as either column names or a constraint
 * name.
 *
 * Anything else -- a collision on users.email, say -- is a real failure. A
 * blanket P2002 catch here would repeat the defect found in PaymentsService on
 * 2026-09-01.
 */
function isIdentityRace(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return false;
  }
  const target = err.meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  return fields.some((field) => field.includes('providerAccountId'));
}
```

Add this private method to the class:

```typescript
  /**
   * Runs a write that may lose the race on [provider, providerAccountId]. The
   * loser is not an error: the winner created exactly the identity we were
   * about to, so re-read it and log in. A double-clicked button therefore
   * yields two successful logins.
   */
  private async raceTolerant(
    provider: IdentityProvider,
    profile: ProviderProfile,
    write: () => Promise<ResolvedIdentity>,
  ): Promise<ResolvedIdentity> {
    try {
      return await write();
    } catch (err) {
      if (!isIdentityRace(err)) throw err;

      const winner = await this.prisma.identity.findUnique({
        where: {
          provider_providerAccountId: {
            provider,
            providerAccountId: profile.providerAccountId,
          },
        },
        include: { user: true },
      });
      // One retry, never a loop: if the row still is not there, the constraint
      // that fired was not the one we think it was.
      if (!winner) throw err;
      if (winner.user.deletedAt) throw new UnauthorizedException();
      return { userId: winner.userId, isNewUser: false, linked: false };
    }
  }
```

Wrap the row-5 link:

```typescript
    return this.raceTolerant(provider, profile, async () => {
      await this.prisma.identity.create({
        data: this.identityData(provider, profile, claimant.id),
      });
      return { userId: claimant.id, isNewUser: false, linked: true };
    });
```

and wrap `createUser`'s body:

```typescript
    return this.raceTolerant(provider, profile, async () => {
      const userId = await this.prisma.$transaction(async (tx: Tx) => {
        const user = await tx.user.create({ /* unchanged */ });
        await tx.identity.create({
          data: this.identityData(provider, profile, user.id),
        });
        return user.id;
      });
      return { userId, isNewUser: true, linked: false };
    });
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest identity-resolver.spec
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/oauth/identity-resolver.ts \
        apps/flick-api/src/auth/oauth/identity-resolver.spec.ts
git commit -m "feat(auth): treat a concurrent first verification as a login

A transaction gives atomicity, not mutual exclusion: under READ COMMITTED
two concurrent verifications for the same provider account both read 'no
identity' and both insert. The unique index is what serializes them, so the
loser re-reads the identity the winner just created and issues a session --
a double-clicked button produces two logins rather than one login and one
error.

The catch is narrowed to the providerAccountId constraint by inspecting
meta.target. A blanket P2002 catch would swallow a genuine collision on
users.email and resolve to whatever identity happened to exist -- the same
defect the review found in PaymentsService on the same day."
```

---

## Task 6: `GoogleProviderAdapter`

**Files:**
- Create: `apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.ts`
- Test: `apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.spec.ts`
- Modify: `apps/flick-api/package.json` (add `jose`)

**Interfaces:**
- Produces: `class GoogleProviderAdapter implements OAuthProviderPort`,
  constructed as `new GoogleProviderAdapter(config: ConfigService)`, plus a
  static `toProfile(claims: Record<string, unknown>): ProviderProfile`.

**Context:** Spec §9.1. Google's ID token is an RS256 JWT signed with a rotating
key published at a JWKS endpoint; `createRemoteJWKSet` handles fetching, caching
and `kid` selection. `iss`, `aud`, `exp` and `nonce` must all be checked — a
token that is merely well-signed but issued for a different client is not a login.

The claim-mapping half is a pure static function so it can be tested without any
network, which is where the `email_verified` parsing lives.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/flick-api && npm install jose
```

- [ ] **Step 2: Write the failing tests**

Create `apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.spec.ts`:

```typescript
import { IdentityProvider } from '@prisma/client';
import { GoogleProviderAdapter } from './google-provider.adapter';

describe('GoogleProviderAdapter', () => {
  it('is the Google provider', () => {
    expect(
      new GoogleProviderAdapter({ getOrThrow: () => 'cid' } as never).id,
    ).toBe(IdentityProvider.GOOGLE);
  });

  it('maps a verified claim set to a profile', () => {
    expect(
      GoogleProviderAdapter.toProfile({
        sub: '1234567890',
        email: 'a@example.com',
        email_verified: true,
        name: 'Somchai',
        picture: 'https://lh3.googleusercontent.com/a',
      }),
    ).toEqual({
      providerAccountId: '1234567890',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'Somchai',
      avatarUrl: 'https://lh3.googleusercontent.com/a',
    });
  });

  it('treats the string "false" as unverified, not as truthy', () => {
    // A truthiness check would read "false" as verified and let the linking
    // rule match an address nobody proved.
    expect(
      GoogleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'false',
      }).emailVerified,
    ).toBe(false);
  });

  it('accepts the string "true" as verified', () => {
    expect(
      GoogleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'true',
      }).emailVerified,
    ).toBe(true);
  });

  it('never reports a verified email when there is no email', () => {
    expect(
      GoogleProviderAdapter.toProfile({ sub: 's', email_verified: true }),
    ).toMatchObject({ email: null, emailVerified: false });
  });

  it('rejects a claim set with no subject', () => {
    expect(() =>
      GoogleProviderAdapter.toProfile({ email: 'a@example.com' }),
    ).toThrow(/sub/);
  });
});
```

- [ ] **Step 3: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest google-provider.adapter.spec
```

Expected: FAIL — `Cannot find module './google-provider.adapter'`.

- [ ] **Step 4: Write the adapter**

Create `apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OAuthProviderPort, ProviderProfile } from '../oauth-provider.port';

const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Only a real boolean true, or the exact string "true", counts as verified. */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

@Injectable()
export class GoogleProviderAdapter implements OAuthProviderPort {
  readonly id = IdentityProvider.GOOGLE;
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<ProviderProfile> {
    // Signature, issuer, audience and expiry. A well-signed token issued for a
    // different client is not a login here.
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ISSUERS,
      audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
    });

    // The replay guard: this token was minted for one nonce we issued once.
    if (payload.nonce !== expectedNonce) {
      throw new Error('Google id_token nonce did not match the issued nonce');
    }

    return GoogleProviderAdapter.toProfile(payload);
  }

  /** Pure claim-set → profile mapping, static so it tests without a network. */
  static toProfile(claims: Record<string, unknown>): ProviderProfile {
    const sub = claims.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new Error('Google id_token carried no sub');
    }
    const email = typeof claims.email === 'string' ? claims.email : null;
    return {
      providerAccountId: sub,
      email,
      emailVerified: email !== null && isVerified(claims.email_verified),
      displayName: typeof claims.name === 'string' ? claims.name : null,
      avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
    };
  }
}
```

- [ ] **Step 5: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest google-provider.adapter.spec
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/package.json apps/flick-api/package-lock.json \
        apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.ts \
        apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.spec.ts
git commit -m "feat(auth): verify Google id_tokens

Adds jose, because validating an id_token means fetching a rotating JWKS
and verifying RS256, and @nestjs/jwt only does HS256 against our own
secret. createRemoteJWKSet handles fetch, cache and kid selection.

Signature, issuer, audience and nonce are all checked -- a well-signed
token issued for a different client is not a login, and the nonce is what
stops a captured token being replayed. Only a real true or the exact
string 'true' counts as a verified email, so a provider sending the string
'false' cannot be read as truthy and slip past the rule that an unverified
email is never matched to an existing account."
```

---

## Task 7: `AppleProviderAdapter`

**Files:**
- Create: `apps/flick-api/src/auth/oauth/adapters/apple-provider.adapter.ts`
- Test: `apps/flick-api/src/auth/oauth/adapters/apple-provider.adapter.spec.ts`

**Interfaces:**
- Produces: `class AppleProviderAdapter implements OAuthProviderPort`,
  constructed as `new AppleProviderAdapter(config: ConfigService)`, plus a
  static `toProfile(claims: Record<string, unknown>): ProviderProfile`.

**Context:** Spec §8. Because we verify the `id_token` and never exchange the
authorization code (spec decision 4), **there is no client secret**: no `.p8`
key, no ES256 JWT to mint, no 6-month rotation. Config needs only
`APPLE_CLIENT_ID`, the Services ID, which is also the `aud` we check.

Three Apple facts shape this adapter:

- `email_verified` arrives as the **string** `"true"`, not a boolean.
- The email may be a per-app relay (`…@privaterelay.appleid.com`). It is real and
  verified; we store it as-is. `is_private_email` is recorded nowhere — it would
  change no decision.
- **The name is not in the token at all.** It arrives beside it, once, in the JS
  response, so `toProfile` always returns `displayName: null` and the controller
  fills it from the request body (Task 9). This adapter must not invent one.

- [ ] **Step 1: Write the failing tests**

Create `apps/flick-api/src/auth/oauth/adapters/apple-provider.adapter.spec.ts`:

```typescript
import { IdentityProvider } from '@prisma/client';
import { AppleProviderAdapter } from './apple-provider.adapter';

describe('AppleProviderAdapter', () => {
  it('is the Apple provider', () => {
    expect(
      new AppleProviderAdapter({ getOrThrow: () => 'cid' } as never).id,
    ).toBe(IdentityProvider.APPLE);
  });

  it('reads email_verified sent as the string "true"', () => {
    // Apple's documented shape. A boolean check alone would treat every Apple
    // user as unverified and never link any of them.
    expect(
      AppleProviderAdapter.toProfile({
        sub: '000123.abc.0001',
        email: 'a@example.com',
        email_verified: 'true',
      }),
    ).toMatchObject({ providerAccountId: '000123.abc.0001', emailVerified: true });
  });

  it('reads email_verified sent as the string "false" as unverified', () => {
    expect(
      AppleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'false',
      }).emailVerified,
    ).toBe(false);
  });

  it('accepts a private relay address as a real verified email', () => {
    expect(
      AppleProviderAdapter.toProfile({
        sub: 's',
        email: 'xyz@privaterelay.appleid.com',
        email_verified: 'true',
        is_private_email: 'true',
      }),
    ).toMatchObject({
      email: 'xyz@privaterelay.appleid.com',
      emailVerified: true,
    });
  });

  it('never carries a display name — Apple does not put one in the token', () => {
    expect(
      AppleProviderAdapter.toProfile({
        sub: 's',
        email: 'a@example.com',
        email_verified: 'true',
      }).displayName,
    ).toBeNull();
  });

  it('tolerates a repeat sign-in that carries no email', () => {
    // Apple sends the email only on the first authorization, ever.
    expect(
      AppleProviderAdapter.toProfile({ sub: 's' }),
    ).toMatchObject({ email: null, emailVerified: false });
  });

  it('rejects a claim set with no subject', () => {
    expect(() => AppleProviderAdapter.toProfile({ email: 'a@example.com' })).toThrow(
      /sub/,
    );
  });
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest apple-provider.adapter.spec
```

Expected: FAIL — `Cannot find module './apple-provider.adapter'`.

- [ ] **Step 3: Write the adapter**

Create `apps/flick-api/src/auth/oauth/adapters/apple-provider.adapter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OAuthProviderPort, ProviderProfile } from '../oauth-provider.port';

const JWKS_URI = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';

/**
 * Apple sends this as the STRING "true"/"false", not a boolean. A truthiness
 * check would read "false" as verified; a strict boolean check would treat every
 * Apple user as unverified and never link any of them.
 */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

@Injectable()
export class AppleProviderAdapter implements OAuthProviderPort {
  readonly id = IdentityProvider.APPLE;
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<ProviderProfile> {
    // No client secret anywhere: we verify the token Apple signed and never
    // exchange the authorization code, so there is no .p8 key to mint an ES256
    // assertion from and no 6-month rotation to schedule.
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ISSUER,
      audience: this.config.getOrThrow<string>('APPLE_CLIENT_ID'),
    });

    if (payload.nonce !== expectedNonce) {
      throw new Error('Apple id_token nonce did not match the issued nonce');
    }

    return AppleProviderAdapter.toProfile(payload);
  }

  /** Pure claim-set → profile mapping, static so it tests without a network. */
  static toProfile(claims: Record<string, unknown>): ProviderProfile {
    const sub = claims.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new Error('Apple id_token carried no sub');
    }
    // Absent on every sign-in after the first: Apple sends the email once, ever.
    const email = typeof claims.email === 'string' ? claims.email : null;

    return {
      providerAccountId: sub,
      // A private relay address is a real, verified, forwarding address. Stored
      // as-is; is_private_email would change no decision we make.
      email,
      emailVerified: email !== null && isVerified(claims.email_verified),
      // Apple puts no name in the token. It arrives beside it, once, in the JS
      // response — the controller fills it from the request body, treating it
      // as an unverified hint. This adapter must not invent one.
      displayName: null,
      avatarUrl: null,
    };
  }
}
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest apple-provider.adapter.spec
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/oauth/adapters/apple-provider.adapter.ts \
        apps/flick-api/src/auth/oauth/adapters/apple-provider.adapter.spec.ts
git commit -m "feat(auth): verify Apple id_tokens

Verifying the token Apple signed rather than exchanging the authorization
code means no client secret at all: no .p8 key, no ES256 assertion to mint,
no 6-month rotation. Config needs only the Services ID, which doubles as
the audience we check.

Three Apple facts get explicit handling. email_verified arrives as the
string 'true', so a boolean check would mark every Apple user unverified
and never link one. A private relay address is a real verified forwarding
address and is stored as-is. And the token carries no name -- Apple sends
it once, beside the token, so toProfile always returns a null display name
and refuses to invent one."
```

---

## Task 8: Registry, module wiring, and fail-closed config

**Files:**
- Create: `apps/flick-api/src/auth/oauth/oauth.module.ts`
- Modify: `apps/flick-api/src/common/config.validation.ts`
- Modify: `apps/flick-api/src/common/config.validation.spec.ts`
- Modify: `apps/flick-api/.env.example`

**Interfaces:**
- Produces: `createOAuthProviderRegistry(config: ConfigService): OAuthProviderRegistry`,
  exported for direct unit testing — the same shape as `createOtpDeliveryPort`
  in `otp.module.ts:15`.

**Context:** `config.validation.ts` already refuses to boot production with a
console OTP adapter or a fake payment gateway (`:27-31`, `:47-51`). A provider
listed without credentials, or the fake adapter in production, belongs in that
list: a half-configured provider otherwise renders a button that dead-ends, and
the fake adapter accepts any self-minted token.

- [ ] **Step 1: Write the failing config tests**

Add to `apps/flick-api/src/common/config.validation.spec.ts`, which defines
`base` at `:4-8`:

```typescript
  it('accepts oauth being switched off entirely', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', OTP_DELIVERY: 'console' }),
    ).not.toThrow();
  });

  it('refuses google listed without its client id', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        OTP_DELIVERY: 'console',
        OAUTH_PROVIDERS: 'google',
      }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('refuses apple listed without its client id', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        OTP_DELIVERY: 'console',
        OAUTH_PROVIDERS: 'apple',
      }),
    ).toThrow(/APPLE_CLIENT_ID/);
  });

  it('refuses an unknown provider name', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        OTP_DELIVERY: 'console',
        OAUTH_PROVIDERS: 'myspace',
      }),
    ).toThrow(/myspace/);
  });

  it('refuses the fake oauth provider in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        TRUST_PROXY_HOPS: '1',
        OTP_DELIVERY: 'live',
        OTP_SMS_ENDPOINT: 'https://sms.test/send',
        OTP_SMS_API_KEY: 'k',
        OTP_EMAIL_ENDPOINT: 'https://email.test/send',
        OTP_EMAIL_API_KEY: 'k',
        PAYMENT_GATEWAY: 'omise',
        OMISE_SECRET_KEY: 'skey',
        OMISE_WEBHOOK_SECRET: 'c2VjcmV0',
        OAUTH_PROVIDERS: 'fake',
      }),
    ).toThrow(/fake/);
  });
```

If `2026-09-01-security-hardening.md` Task 5 has landed, a `productionBase`
helper exists — use it for the last test instead of repeating the literal.

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest config.validation.spec
```

Expected: the four refusal tests FAIL — nothing throws today.

- [ ] **Step 3: Add the rules**

In `apps/flick-api/src/common/config.validation.ts`, before `return config;`:

```typescript
  const KNOWN_OAUTH_PROVIDERS: Record<string, string[]> = {
    google: ['GOOGLE_CLIENT_ID'],
    // No client secret: we verify the id_token and never exchange a code.
    apple: ['APPLE_CLIENT_ID'],
    // Test-only. Refused in production below.
    fake: [],
  };

  const oauthProviders = String(config.OAUTH_PROVIDERS ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  for (const name of oauthProviders) {
    const required = KNOWN_OAUTH_PROVIDERS[name];
    if (required === undefined) {
      throw new Error(
        `OAUTH_PROVIDERS lists an unknown provider "${name}". Known: ${Object.keys(KNOWN_OAUTH_PROVIDERS).join(', ')}`,
      );
    }
    if (isProduction && name === 'fake') {
      throw new Error(
        'OAUTH_PROVIDERS must not include "fake" in production — it accepts any self-minted token and would hand out sessions',
      );
    }
    const missing = required.filter((key) => !config[key]);
    if (missing.length > 0) {
      throw new Error(
        `OAUTH_PROVIDERS includes "${name}" but is missing: ${missing.join(', ')}`,
      );
    }
  }
```

- [ ] **Step 4: Write the module**

Create `apps/flick-api/src/auth/oauth/oauth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import {
  OAUTH_PROVIDER_REGISTRY,
  type OAuthProviderRegistry,
} from './oauth-provider.port';
import { GoogleProviderAdapter } from './adapters/google-provider.adapter';
import { AppleProviderAdapter } from './adapters/apple-provider.adapter';
import { FakeOAuthProviderAdapter } from './adapters/fake-provider.adapter';
import { OAuthNonceService } from './oauth-nonce.service';
import { IdentityResolver } from './identity-resolver';

// Exported rather than inlined so it can be unit-tested with a stubbed
// ConfigService, the same way createOtpDeliveryPort is (otp.module.ts:15).
export function createOAuthProviderRegistry(
  config: ConfigService,
): OAuthProviderRegistry {
  const enabled = String(config.get<string>('OAUTH_PROVIDERS', ''))
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const registry: OAuthProviderRegistry = new Map();
  // validateEnv has already rejected unknown names and missing credentials, so
  // anything reaching here is configured.
  if (enabled.includes('google')) {
    registry.set(IdentityProvider.GOOGLE, new GoogleProviderAdapter(config));
  }
  if (enabled.includes('apple')) {
    registry.set(IdentityProvider.APPLE, new AppleProviderAdapter(config));
  }
  if (enabled.includes('fake')) {
    // Stands in for BOTH providers so e2e can exercise either path.
    registry.set(
      IdentityProvider.GOOGLE,
      new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE),
    );
    registry.set(
      IdentityProvider.APPLE,
      new FakeOAuthProviderAdapter(IdentityProvider.APPLE),
    );
  }
  return registry;
}

@Module({
  imports: [ConfigModule],
  providers: [
    OAuthNonceService,
    IdentityResolver,
    {
      provide: OAUTH_PROVIDER_REGISTRY,
      inject: [ConfigService],
      useFactory: createOAuthProviderRegistry,
    },
  ],
  exports: [OAuthNonceService, IdentityResolver, OAUTH_PROVIDER_REGISTRY],
})
export class OAuthModule {}
```

- [ ] **Step 5: Document the variables**

Add to `apps/flick-api/.env.example`, below the OTP block:

```bash
# Social login. Comma-separated; empty or unset disables the feature entirely.
# "fake" is a test-only adapter that accepts any self-minted token and is
# refused in production.
# OAUTH_PROVIDERS=google,apple
# GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
# Apple Services ID. No client secret: we verify the id_token and never
# exchange an authorization code, so there is no .p8 key to rotate.
# APPLE_CLIENT_ID=com.flick.web
```

- [ ] **Step 6: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest config.validation.spec && npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd apps/flick-api && npm run lint
git add apps/flick-api/src/auth/oauth/oauth.module.ts \
        apps/flick-api/src/common/config.validation.ts \
        apps/flick-api/src/common/config.validation.spec.ts \
        apps/flick-api/.env.example
git commit -m "feat(auth): wire the OAuth provider registry, fail closed

A provider listed in OAUTH_PROVIDERS without its client id is now a boot
failure rather than a button that dead-ends, an unknown provider name is
refused outright, and the fake adapter -- which accepts any self-minted
token -- cannot be selected in production. Same fail-closed treatment
config.validation already gives the console OTP adapter and the fake
payment gateway.

Apple needs only a Services ID here: no client secret, because we verify
the id_token and never exchange a code."
```

---

## Task 9: `/providers`, `/nonce`, `/verify`

**Files:**
- Create: `apps/flick-api/src/auth/oauth/dto/verify-oauth.dto.ts`
- Create: `apps/flick-api/src/auth/oauth/oauth.controller.ts`
- Create: `apps/flick-api/src/auth/oauth/oauth.controller.spec.ts`
- Create: `apps/flick-api/test/oauth.e2e-spec.ts`
- Modify: `apps/flick-api/src/app.module.ts`

**Interfaces:**
- Consumes: `OAuthNonceService`, `IdentityResolver`, `OAUTH_PROVIDER_REGISTRY`.
- Produces: `GET /auth/oauth/providers`, `POST /auth/oauth/nonce`,
  `POST /auth/oauth/verify`.

**Context:** Spec §6.4 and §6.5. Session issuance reuses the exact cookie options
from `auth.controller.ts:38-46`, and the token is stripped from the response body
the way `verifyOtp` already strips it (`:74-76`).

The order inside `/verify` matters: **consume the nonce before verifying the
token.** A nonce spent on a token that then fails verification is correct — it
was still spent — and doing it the other way round lets an attacker probe token
validity without burning anything.

- [ ] **Step 1: Write the DTO**

Create `apps/flick-api/src/auth/oauth/dto/verify-oauth.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Note what `displayName` is NOT: an identity. Apple sends the user's name
 * beside the token rather than inside it, so this field is caller-supplied and
 * unverified. It may fill a display name when the token carried none, and it
 * must never influence identity, email, or linking.
 */
export class VerifyOAuthDto {
  @IsIn(['google', 'apple'])
  provider: 'google' | 'apple';

  @IsString()
  @MinLength(16)
  @MaxLength(8192)
  idToken: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  nonce: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}
```

- [ ] **Step 2: Write the failing controller tests**

Create `apps/flick-api/src/auth/oauth/oauth.controller.spec.ts`:

```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { OAuthController } from './oauth.controller';
import { FakeOAuthProviderAdapter } from './adapters/fake-provider.adapter';
import type { OAuthProviderRegistry } from './oauth-provider.port';

describe('OAuthController', () => {
  let controller: OAuthController;
  let nonces: { issue: jest.Mock; consume: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let users: { findById: jest.Mock };
  let res: { cookie: jest.Mock };

  const registry: OAuthProviderRegistry = new Map([
    [IdentityProvider.GOOGLE, new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE)],
  ]);

  const profile = {
    providerAccountId: 'sub_1',
    email: 'a@example.com',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: null,
  };
  const token = (nonce = 'n_1') => FakeOAuthProviderAdapter.mint(profile, nonce);

  beforeEach(() => {
    nonces = {
      issue: jest.fn().mockResolvedValue({ nonce: 'n_1', expiresIn: 300 }),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    resolver = {
      resolve: jest.fn().mockResolvedValue({
        userId: 'u1', isNewUser: false, linked: false,
      }),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('tok') };
    users = {
      findById: jest.fn().mockResolvedValue({
        id: 'u1', email: 'a@example.com', phone: null, displayName: 'A',
      }),
    };
    res = { cookie: jest.fn() };

    controller = new OAuthController(
      registry,
      nonces as never,
      resolver as never,
      jwt as never,
      users as never,
      { get: (_k: string, d?: string) => d ?? '7d' } as never,
    );
  });

  it('lists only configured providers', () => {
    expect(controller.providers()).toEqual({ providers: ['google'] });
  });

  it('404s a provider that is not configured', async () => {
    await expect(
      controller.nonce({ provider: 'apple' } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('sets an HttpOnly cookie and keeps the token out of the body', async () => {
    const result = await controller.verify(
      { provider: 'google', idToken: token(), nonce: 'n_1' },
      res as never,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'access_token', 'tok', expect.objectContaining({ httpOnly: true }),
    );
    expect(JSON.stringify(result)).not.toContain('tok');
    expect(result).toMatchObject({ success: true, user: { id: 'u1' } });
  });

  it('burns the nonce before it trusts the token', async () => {
    await controller.verify(
      { provider: 'google', idToken: token(), nonce: 'n_1' },
      res as never,
    );

    // Verifying first would let an attacker probe token validity for free.
    expect(nonces.consume).toHaveBeenCalledWith('n_1', IdentityProvider.GOOGLE);
    expect(nonces.consume.mock.invocationCallOrder[0]).toBeLessThan(
      resolver.resolve.mock.invocationCallOrder[0],
    );
  });

  it('rejects a token minted for a different nonce', async () => {
    await expect(
      controller.verify(
        { provider: 'google', idToken: token('someone_elses'), nonce: 'n_1' },
        res as never,
      ),
    ).rejects.toThrow();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('uses a caller-supplied name only when the token carried none', async () => {
    const anon = FakeOAuthProviderAdapter.mint(
      { ...profile, displayName: null }, 'n_1',
    );

    await controller.verify(
      { provider: 'google', idToken: anon, nonce: 'n_1', displayName: 'Ploy' },
      res as never,
    );

    const [, passed] = resolver.resolve.mock.calls[0] as [unknown, typeof profile];
    expect(passed.displayName).toBe('Ploy');
  });

  it('never lets a caller-supplied name override the token', async () => {
    await controller.verify(
      { provider: 'google', idToken: token(), nonce: 'n_1', displayName: 'Attacker' },
      res as never,
    );

    const [, passed] = resolver.resolve.mock.calls[0] as [unknown, typeof profile];
    expect(passed.displayName).toBe('A');
  });

  it('surfaces the refuse-to-link case as a 409', async () => {
    resolver.resolve.mockRejectedValue(new ConflictException('claimed'));

    await expect(
      controller.verify(
        { provider: 'google', idToken: token(), nonce: 'n_1' },
        res as never,
      ),
    ).rejects.toThrow(ConflictException);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest oauth.controller.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the controller**

Create `apps/flick-api/src/auth/oauth/oauth.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IdentityProvider } from '@prisma/client';
import type { Response } from 'express';
import ms from 'ms';
import { Public } from '../public.decorator';
import { DEFAULT_JWT_EXPIRES_IN } from '../jwt.config';
import { UsersService } from '../../users/users.service';
import {
  OAUTH_PROVIDER_REGISTRY,
  type OAuthProviderRegistry,
} from './oauth-provider.port';
import { OAuthNonceService } from './oauth-nonce.service';
import { IdentityResolver } from './identity-resolver';
import { VerifyOAuthDto } from './dto/verify-oauth.dto';

const PROVIDER_IDS: Record<string, IdentityProvider> = {
  google: IdentityProvider.GOOGLE,
  apple: IdentityProvider.APPLE,
};

@Controller('auth/oauth')
export class OAuthController {
  private readonly tokenMaxAge: number;

  constructor(
    @Inject(OAUTH_PROVIDER_REGISTRY)
    private readonly registry: OAuthProviderRegistry,
    private readonly nonces: OAuthNonceService,
    private readonly resolver: IdentityResolver,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.tokenMaxAge = ms(
      config.get<string>('JWT_EXPIRES_IN', DEFAULT_JWT_EXPIRES_IN) as ms.StringValue,
    );
  }

  /** Lets the login screen render only buttons that will work. */
  @Public()
  @Get('providers')
  providers(): { providers: string[] } {
    return { providers: [...this.registry.keys()].map((id) => id.toLowerCase()) };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('nonce')
  async nonce(
    @Body() body: { provider: string },
  ): Promise<{ nonce: string; expiresIn: number }> {
    return this.nonces.issue(this.adapterFor(body?.provider).id);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verify(
    @Body() dto: VerifyOAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adapter = this.adapterFor(dto.provider);

    // Burn the nonce FIRST. Spending it on a token that then fails
    // verification is correct — it was still spent — and doing it the other way
    // round would let an attacker probe token validity for free.
    await this.nonces.consume(dto.nonce, adapter.id);

    const profile = await adapter.verifyIdToken(dto.idToken, dto.nonce);

    // Apple sends the name beside the token, not inside it, so the client
    // passes it through. Unverified, and used only to fill a gap: it can never
    // override what the provider signed.
    if (!profile.displayName && dto.displayName) {
      profile.displayName = dto.displayName;
    }

    const resolved = await this.resolver.resolve(adapter.id, profile);
    const user = await this.users.findById(resolved.userId);
    if (!user) throw new UnauthorizedException();

    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });

    // The same cookie the OTP flow sets — auth.controller.ts:38-46. Social
    // login is a second way to mint the existing session, not a second session.
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.tokenMaxAge,
    });

    // The token goes in the HttpOnly cookie and nowhere a script can read it,
    // exactly as AuthController.verifyOtp strips it (auth.controller.ts:74-76).
    return {
      success: true as const,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
      },
      isNewUser: resolved.isNewUser,
    };
  }

  private adapterFor(provider: string) {
    const id = PROVIDER_IDS[provider?.toLowerCase?.()];
    const adapter = id ? this.registry.get(id) : undefined;
    if (!adapter) throw new NotFoundException('Unknown or unconfigured provider');
    return adapter;
  }
}
```

Register it in `apps/flick-api/src/app.module.ts`: import `OAuthModule`, add it
to `imports`, add `OAuthController` to `controllers`. `JwtModule` and
`UsersModule` must be available — import them the way `AuthModule` does.

- [ ] **Step 5: Write the e2e test**

Create `apps/flick-api/test/oauth.e2e-spec.ts`, following the shape of
`test/auth.e2e-spec.ts` and booting with `OAUTH_PROVIDERS=fake`:

```typescript
  const signIn = async (profile: Record<string, unknown>) => {
    const issued = await request(app.getHttpServer())
      .post('/auth/oauth/nonce')
      .send({ provider: 'google' })
      .expect(200);
    const nonce = (issued.body as { nonce: string }).nonce;

    return request(app.getHttpServer())
      .post('/auth/oauth/verify')
      .send({
        provider: 'google',
        nonce,
        idToken: FakeOAuthProviderAdapter.mint(profile as never, nonce),
      });
  };

  it('creates a user and sets an HttpOnly session cookie', async () => {
    const res = await signIn({
      providerAccountId: 'sub_e2e', email: 'e2e-oauth@flick.test',
      emailVerified: true, displayName: 'E2E', avatarUrl: null,
    }).expect(200);

    expect(res.headers['set-cookie'][0]).toContain('access_token=');
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(JSON.stringify(res.body)).not.toContain('access_token');
  });

  it('refuses to spend the same nonce twice', async () => {
    const issued = await request(app.getHttpServer())
      .post('/auth/oauth/nonce')
      .send({ provider: 'google' })
      .expect(200);
    const nonce = (issued.body as { nonce: string }).nonce;
    const body = {
      provider: 'google',
      nonce,
      idToken: FakeOAuthProviderAdapter.mint(
        { providerAccountId: 'sub_replay', email: null, emailVerified: false,
          displayName: null, avatarUrl: null } as never,
        nonce,
      ),
    };

    await request(app.getHttpServer()).post('/auth/oauth/verify').send(body).expect(200);
    // A captured request must be worth nothing the second time.
    await request(app.getHttpServer()).post('/auth/oauth/verify').send(body).expect(400);
  });

  it('logs the same provider account back into the same user', async () => {
    const profile = {
      providerAccountId: 'sub_stable', email: 'stable@flick.test',
      emailVerified: true, displayName: 'Stable', avatarUrl: null,
    };
    const first = await signIn(profile).expect(200);
    const second = await signIn(profile).expect(200);

    const idOf = async (res: request.Response) => {
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', res.headers['set-cookie'] as unknown as string[])
        .expect(200);
      return (me.body as { id: string }).id;
    };

    // A second sign-in is a login, not a second account.
    expect(await idOf(first)).toBe(await idOf(second));
  });
```

- [ ] **Step 6: Run everything**

```bash
cd apps/flick-api && npm test && npm run test:e2e && npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/src/auth/oauth/ apps/flick-api/test/oauth.e2e-spec.ts \
        apps/flick-api/src/app.module.ts
git commit -m "feat(auth): add the social sign-in verification endpoints

One endpoint verifies every provider: the body names it, the registry
resolves it, and the resolver never learns which one it was. Social login
mints the existing access_token cookie rather than inventing a session, so
JwtStrategy, the guards and the frontend's getSession are untouched, and
the token is stripped from the response body exactly as verifyOtp strips
it.

The nonce is burned before the token is trusted. Spending it on a token
that then fails verification is correct -- it was still spent -- while
verifying first would let an attacker probe token validity without burning
anything. A caller-supplied display name, which is how Apple's name
reaches us, can only fill a gap the token left and never override a signed
claim."
```

---

## Task 10: Frontend client and API contract

**Files:**
- Modify: `apps/flick-app/src/types/api.ts`
- Create: `apps/flick-app/src/features/auth/oauth.ts`
- Create: `apps/flick-app/src/features/auth/oauth.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  fetchOAuthProviders(): Promise<string[]>
  requestNonce(provider: 'google' | 'apple'): Promise<string>
  verifyOAuth(input: { provider; idToken; nonce; displayName? }): Promise<OAuthVerifyResult>
  ```
  where `OAuthVerifyResult` is
  `{ success: true; user: AuthUser; isNewUser: boolean } | { success: false; error: string; claimed?: boolean }`.

**Context:** `apiFetch` is typed by the `ApiPath` union (`types/api.ts:22-40`)
with a matching `ApiResponse` conditional and a runtime decoder — three new
endpoints must be added to all three or they will not type-check. The `claimed`
flag on failure is how Task 11 knows to render the §6.3 message rather than a
generic error.

- [ ] **Step 1: Register the endpoints in the contract**

In `apps/flick-app/src/types/api.ts` add to the `ApiPath` union:

```typescript
  | '/auth/oauth/providers'
  | '/auth/oauth/nonce'
  | '/auth/oauth/verify'
```

to `ApiResponse`:

```typescript
  : Path extends '/auth/oauth/providers' ? { providers: string[] }
  : Path extends '/auth/oauth/nonce' ? { nonce: string; expiresIn: number }
  : Path extends '/auth/oauth/verify' ? OtpVerifyResponse
```

`/verify` reuses `OtpVerifyResponse` deliberately: both endpoints return the same
`{ success, user, isNewUser }` shape, and one type for one shape keeps them from
drifting apart. Add decode branches inside `decodeApiResponse` matching how the
neighbouring branches validate.

- [ ] **Step 2: Write the failing tests**

Create `apps/flick-app/src/features/auth/oauth.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyOAuth } from './oauth';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.restoreAllMocks());

describe('verifyOAuth', () => {
  const input = { provider: 'google' as const, idToken: 't', nonce: 'n' };

  it('reports the signed-in user on success', async () => {
    respond(200, {
      success: true,
      user: { id: 'u1', email: 'a@example.com', phone: null, displayName: 'A' },
      isNewUser: false,
    });

    await expect(verifyOAuth(input)).resolves.toMatchObject({
      success: true,
      user: { id: 'u1' },
    });
  });

  it('flags a 409 as the claimed-email case, not a generic failure', async () => {
    // The login screen renders a specific instruction for this one.
    respond(409, { message: 'มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว' });

    await expect(verifyOAuth(input)).resolves.toMatchObject({
      success: false,
      claimed: true,
    });
  });

  it('reports other failures without the claimed flag', async () => {
    respond(400, { message: 'Invalid or expired login request' });

    const result = await verifyOAuth(input);
    expect(result).toMatchObject({ success: false });
    expect((result as { claimed?: boolean }).claimed).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them to watch them fail**

```bash
cd apps/flick-app && npx vitest run src/features/auth/oauth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the client**

Create `apps/flick-app/src/features/auth/oauth.ts`:

```typescript
'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { clearLegacyLocalState } from './legacyStorage';

export type OAuthProviderId = 'google' | 'apple';

interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
}

export type OAuthVerifyResult =
  | { success: true; user: AuthUser; isNewUser: boolean }
  | { success: false; error: string; claimed?: boolean };

const NETWORK_ERROR = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';
const GENERIC_ERROR = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';

/** Which providers the API actually has credentials for. */
export async function fetchOAuthProviders(): Promise<string[]> {
  try {
    return (await apiFetch('/auth/oauth/providers')).providers;
  } catch {
    // No list means no buttons, not a broken page: OTP still works.
    return [];
  }
}

/**
 * A fresh nonce per attempt. The SDK embeds it in the signed token and the
 * server burns it once, so a captured token cannot be replayed.
 */
export async function requestNonce(provider: OAuthProviderId): Promise<string> {
  const data = await apiFetch('/auth/oauth/nonce', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
  return data.nonce;
}

export async function verifyOAuth(input: {
  provider: OAuthProviderId;
  idToken: string;
  nonce: string;
  displayName?: string;
}): Promise<OAuthVerifyResult> {
  try {
    const data = await apiFetch('/auth/oauth/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    clearLegacyLocalState();
    return { success: true, user: data.user, isNewUser: data.isNewUser };
  } catch (err) {
    if (err instanceof ApiError) {
      // 409 is the one failure with its own instruction to give (spec §6.3).
      if (err.status === 409) {
        return { success: false, error: err.message || GENERIC_ERROR, claimed: true };
      }
      return { success: false, error: err.message || GENERIC_ERROR };
    }
    return { success: false, error: NETWORK_ERROR };
  }
}
```

- [ ] **Step 5: Run them to watch them pass**

```bash
cd apps/flick-app && npx vitest run src/features/auth/oauth.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
cd apps/flick-app && npm test && npm run lint
git add apps/flick-app/src/types/api.ts apps/flick-app/src/features/auth/oauth.ts \
        apps/flick-app/src/features/auth/oauth.test.ts
git commit -m "feat(app): add the social sign-in API client

Three endpoints registered in the typed API contract, and a fresh nonce
per attempt so a captured token cannot be replayed. /verify reuses
OtpVerifyResponse because both endpoints return the same shape, and one
type for one shape keeps them from drifting.

A 409 is flagged as the claimed-email case rather than folded into a
generic failure: it is the one error with a specific instruction for the
user, and the login screen needs to tell it apart."
```

---

## Task 11: The login screen — both buttons

**Files:**
- Create: `apps/flick-app/src/features/auth/useGoogleSignIn.ts`
- Create: `apps/flick-app/src/features/auth/useAppleSignIn.ts`
- Modify: `apps/flick-app/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `requestNonce`, `verifyOAuth`, `fetchOAuthProviders` (Task 10).

**Context:** Both SDKs are provider-hosted scripts loaded with `next/script` —
no npm dependency (spec §9.1). The flow is identical for both: request a nonce,
hand it to the SDK, get an `id_token` back, post it to `/verify`, then navigate
using the existing `resolveLoginDestination` from `loginRedirect.ts`.

Apple's `signIn()` resolves with `authorization.id_token` and, **on the first
authorization only**, a `user.name` object. That name must be read here and
passed to `/verify` — it never appears again (spec §8.3).

Environment: both need a public client id at build time —
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_APPLE_CLIENT_ID`. Add both to
`apps/flick-app/.env.example`.

- [ ] **Step 1: Write the Google hook**

Create `apps/flick-app/src/features/auth/useGoogleSignIn.ts`:

```typescript
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestNonce, verifyOAuth, type OAuthVerifyResult } from './oauth';

const SDK_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse { credential?: string }

/**
 * Google Identity Services renders its own button into a container we own, so
 * the flow is: get a nonce, initialize with it, let GSI draw the button, and
 * post whatever credential comes back.
 */
export function useGoogleSignIn(
  enabled: boolean,
  onResult: (result: OAuthVerifyResult) => void,
) {
  const container = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse, nonce: string) => {
      if (!response.credential) return;
      onResult(
        await verifyOAuth({
          provider: 'google',
          idToken: response.credential,
          nonce,
        }),
      );
    },
    [onResult],
  );

  useEffect(() => {
    if (!enabled || !container.current) return;
    let cancelled = false;

    void (async () => {
      const nonce = await requestNonce('google');
      if (cancelled) return;

      const start = () => {
        const gsi = (window as unknown as { google?: any }).google;
        if (!gsi?.accounts?.id || !container.current) return;
        gsi.accounts.id.initialize({
          client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
          // Embedded in the signed token; the server burns it once.
          nonce,
          callback: (r: GoogleCredentialResponse) => void handleCredential(r, nonce),
        });
        gsi.accounts.id.renderButton(container.current, {
          theme: 'outline', size: 'large', width: 320, text: 'signin_with',
        });
        setReady(true);
      };

      if ((window as unknown as { google?: unknown }).google) return start();
      const script = document.createElement('script');
      script.src = SDK_SRC;
      script.async = true;
      script.onload = start;
      document.head.appendChild(script);
    })();

    return () => { cancelled = true; };
  }, [enabled, handleCredential]);

  return { container, ready };
}
```

- [ ] **Step 2: Write the Apple hook**

Create `apps/flick-app/src/features/auth/useAppleSignIn.ts`:

```typescript
'use client';
import { useCallback, useEffect, useState } from 'react';
import { requestNonce, verifyOAuth, type OAuthVerifyResult } from './oauth';

const SDK_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

interface AppleSignInResponse {
  authorization?: { id_token?: string };
  user?: { name?: { firstName?: string; lastName?: string } };
}

/** Apple gives us a popup we trigger ourselves, not a rendered button. */
export function useAppleSignIn(
  enabled: boolean,
  onResult: (result: OAuthVerifyResult) => void,
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || (window as unknown as { AppleID?: unknown }).AppleID) {
      if (enabled) setReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, [enabled]);

  const signIn = useCallback(async () => {
    const AppleID = (window as unknown as { AppleID?: any }).AppleID;
    if (!AppleID) return;

    const nonce = await requestNonce('apple');
    AppleID.auth.init({
      clientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID,
      scope: 'name email',
      redirectURI: window.location.origin + '/login',
      usePopup: true,
      nonce,
    });

    let response: AppleSignInResponse;
    try {
      response = (await AppleID.auth.signIn()) as AppleSignInResponse;
    } catch {
      return; // The user closed the popup. Not an error worth showing.
    }

    const idToken = response.authorization?.id_token;
    if (!idToken) return;

    // Apple sends the name ONCE, beside the token and never inside it. Read it
    // here or it is gone forever. The server treats it as an unverified hint.
    const name = response.user?.name;
    const displayName = [name?.firstName, name?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    onResult(
      await verifyOAuth({
        provider: 'apple',
        idToken,
        nonce,
        displayName: displayName || undefined,
      }),
    );
  }, [onResult]);

  return { signIn, ready };
}
```

- [ ] **Step 3: Wire the login screen**

In `apps/flick-app/src/app/login/page.tsx`, inside `LoginForm`:

```tsx
  const [providers, setProviders] = useState<string[]>([]);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => { void fetchOAuthProviders().then(setProviders); }, []);

  const handleSocial = useCallback((result: OAuthVerifyResult) => {
    if (result.success) {
      router.replace(resolveLoginDestination(searchParams.get('next')));
      return;
    }
    setClaimed(Boolean(result.claimed));
    setError(result.claimed ? '' : result.error);
  }, [router, searchParams]);

  const google = useGoogleSignIn(providers.includes('google'), handleSocial);
  const apple = useAppleSignIn(providers.includes('apple'), handleSocial);
```

Render below the phone form, only when at least one provider is configured:

```tsx
  {providers.length > 0 && (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-fg-mute">
        <span className="h-px flex-1 bg-line" />หรือ<span className="h-px flex-1 bg-line" />
      </div>
      {providers.includes('google') && <div ref={google.container} />}
      {providers.includes('apple') && (
        <button
          type="button"
          onClick={() => void apple.signIn()}
          disabled={!apple.ready}
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-medium text-fg disabled:opacity-50"
        >
          เข้าสู่ระบบด้วย Apple
        </button>
      )}
    </div>
  )}
```

And the §6.3 message, above the form, using this exact string:

```tsx
  {claimed && (
    <p role="alert" className="rounded-xl bg-ink-1 p-3 text-sm text-fg-mute">
      มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์
    </p>
  )}
```

Do not translate or reword it — it is specified verbatim in spec §6.3 and says
"an account", never "your account", on purpose.

- [ ] **Step 4: Document the public client ids**

Add to `apps/flick-app/.env.example`:

```bash
# Public client ids for social sign-in. Safe to expose — they identify the app
# to the provider and are visible in the browser by design.
# NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
# NEXT_PUBLIC_APPLE_CLIENT_ID=com.flick.web
```

- [ ] **Step 5: Run the tests**

```bash
cd apps/flick-app && npm test && npm run lint && npm run build
```

Expected: PASS, 92 tests (89 + 3 from Task 10). The hooks are exercised
end-to-end in Task 13's manual round trip — driving two third-party SDKs under
jsdom would test the mocks, not the integration.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-app/src/features/auth/useGoogleSignIn.ts \
        apps/flick-app/src/features/auth/useAppleSignIn.ts \
        apps/flick-app/src/app/login/page.tsx apps/flick-app/.env.example
git commit -m "feat(app): offer Google and Apple sign-in on the login screen

Buttons render only for providers the API reports configured, so a
half-configured deploy shows no dead end. Both SDKs are provider-hosted
scripts, so the frontend gains no npm dependency. Each attempt takes a
fresh nonce, which the SDK embeds in the signed token and the server burns
once.

Apple's name is read from the sign-in response and passed through: it
arrives once, beside the token and never inside it, so not reading it there
loses it forever. The refuse-to-link case renders its own instruction
rather than a generic failure."
```

---

## Task 12: The scheduled reaper

**Files:**
- Create: `apps/flick-api/src/maintenance/prune.service.ts`
- Create: `apps/flick-api/src/maintenance/prune.service.spec.ts`
- Create: `apps/flick-api/src/maintenance/maintenance.module.ts`
- Modify: `apps/flick-api/src/app.module.ts`, `apps/flick-api/package.json`

**Interfaces:**
- Produces: `PruneService.pruneExpired(): Promise<{ oauthNonces: number; otpChallenges: number }>`,
  callable directly so the test does not wait on a cron.

**Context:** Spec §9. `OtpChallenge` is included because it has the same
unbounded growth and an `@@index([expiresAt])` (`schema.prisma:120`) added for a
reaper nobody wrote.

**The retention floor is this task's hardest test.** `enforceRateLimits`
(`otp.service.ts:159-198`) derives all four OTP limits by *counting*
`OtpChallenge` rows over `OTP_LONG_WINDOW_MS` (24h). Deleting a row inside that
window silently weakens the abuse control with nothing in the logs. 7 days clears
it by 7×, and the test asserts the *relationship*, not the literal.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/flick-api && npm install @nestjs/schedule
```

- [ ] **Step 2: Write the failing tests**

Create `apps/flick-api/src/maintenance/prune.service.spec.ts`:

```typescript
import {
  OAUTH_NONCE_RETENTION_MS,
  OTP_CHALLENGE_RETENTION_MS,
  PruneService,
} from './prune.service';
import { OTP_LONG_WINDOW_MS } from '../auth/otp/otp.config';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PruneService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: PruneService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.oAuthNonce.deleteMany.mockResolvedValue({ count: 3 });
    prisma.otpChallenge.deleteMany.mockResolvedValue({ count: 7 });
    service = new PruneService(prisma as unknown as PrismaService);
  });

  it('keeps OTP challenges longer than the rate limiter counts them', () => {
    // enforceRateLimits COUNTS OtpChallenge rows over OTP_LONG_WINDOW_MS.
    // Deleting inside that window would weaken the abuse control silently.
    // Asserted as a relationship so a future trim cannot cross the floor.
    expect(OTP_CHALLENGE_RETENTION_MS).toBeGreaterThan(OTP_LONG_WINDOW_MS);
  });

  it('deletes only rows past their retention', async () => {
    const before = Date.now();
    await service.pruneExpired();

    const call = prisma.otpChallenge.deleteMany.mock.calls[0][0] as {
      where: { expiresAt: { lt: Date } };
    };
    const cutoff = call.where.expiresAt.lt.getTime();
    expect(cutoff).toBeLessThanOrEqual(before - OTP_CHALLENGE_RETENTION_MS + 1000);
    expect(cutoff).toBeGreaterThan(before - OTP_CHALLENGE_RETENTION_MS - 5000);
  });

  it('reports what it removed', async () => {
    await expect(service.pruneExpired()).resolves.toEqual({
      oauthNonces: 3,
      otpChallenges: 7,
    });
  });

  it('prunes nonces on their own, shorter retention', async () => {
    await service.pruneExpired();

    expect(OAUTH_NONCE_RETENTION_MS).toBeLessThan(OTP_CHALLENGE_RETENTION_MS);
    expect(prisma.oAuthNonce.deleteMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest prune.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the service**

Create `apps/flick-api/src/maintenance/prune.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

/** Nothing reads a nonce a day after it expired. */
export const OAUTH_NONCE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 7 days. These rows carry ipAddress, so the period is a privacy decision under
 * PDPA, not an engineering one — long enough for debugging and abuse
 * mitigation, short enough to keep the footprint small.
 *
 * FLOOR: must stay well above OTP_LONG_WINDOW_MS (24h). enforceRateLimits
 * derives all four OTP limits by COUNTING these rows over that window, so
 * deleting inside it would quietly weaken the abuse control with nothing in the
 * logs to show for it. prune.service.spec asserts the relationship.
 */
export const OTP_CHALLENGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class PruneService {
  private readonly logger = new Logger(PruneService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent, so running on every instance is harmless — no leader election. */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const removed = await this.pruneExpired();
    if (removed.oauthNonces > 0 || removed.otpChallenges > 0) {
      this.logger.log(
        `Pruned ${removed.oauthNonces} oauth nonces, ${removed.otpChallenges} otp challenges`,
      );
    }
  }

  async pruneExpired(): Promise<{ oauthNonces: number; otpChallenges: number }> {
    const now = Date.now();

    const [oauthNonces, otpChallenges] = await Promise.all([
      this.prisma.oAuthNonce.deleteMany({
        where: { expiresAt: { lt: new Date(now - OAUTH_NONCE_RETENTION_MS) } },
      }),
      this.prisma.otpChallenge.deleteMany({
        where: { expiresAt: { lt: new Date(now - OTP_CHALLENGE_RETENTION_MS) } },
      }),
    ]);

    return {
      oauthNonces: oauthNonces.count,
      otpChallenges: otpChallenges.count,
    };
  }
}
```

Create `apps/flick-api/src/maintenance/maintenance.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PruneService } from './prune.service';

@Module({ providers: [PruneService], exports: [PruneService] })
export class MaintenanceModule {}
```

In `apps/flick-api/src/app.module.ts`, add `ScheduleModule.forRoot()` and
`MaintenanceModule` to `imports`.

- [ ] **Step 5: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest prune.service.spec && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd apps/flick-api && npm run lint
git add apps/flick-api/src/maintenance/ apps/flick-api/src/app.module.ts \
        apps/flick-api/package.json apps/flick-api/package-lock.json
git commit -m "feat(api): prune expired oauth nonces and otp challenges

Both tables grow without bound; OtpChallenge has had an @@index([expiresAt])
waiting for a reaper nobody wrote. Nonces die a day after expiry, OTP
challenges after 7 days -- a PDPA decision about the ipAddress those rows
carry, not an engineering one.

The 7 days has a floor worth naming: enforceRateLimits derives all four OTP
limits by counting these rows over a 24h window, so deleting inside it
would weaken the abuse control with nothing in the logs. The test asserts
the relationship to OTP_LONG_WINDOW_MS rather than the literal, so a future
trim cannot silently cross it. Both deletes are idempotent, so running on
every instance needs no leader election."
```

---

## Task 13: Whole-pass verification

**Files:** none modified — verification only.

- [ ] **Step 1: The gate CI runs, in CI's order**

```bash
npm run lint --workspaces
git diff --exit-code
npm run test --workspace=flick-api
npm run test:e2e --workspace=flick-api
npm test
npm run build --workspaces
npm run performance:check
```

Expected: all green. Record both test counts.

- [ ] **Step 2: Security audit**

Confirm each by reading the code, not by assuming:

```bash
cd apps/flick-api
# No blanket P2002 catch was introduced.
grep -rn "P2002" src/auth/oauth/          # every hit must inspect meta.target
# No token, nonce or claim set can reach a log.
grep -rn "logger\." src/auth/oauth/
# The two rules that must never break have tests.
npx jest identity-resolver.spec -t "NEVER links"
npx jest oauth-nonce.service.spec -t "replay"
# Both adapters parse the string form of email_verified.
npx jest adapter.spec -t '"false"'
```

- [ ] **Step 3: Manual round trip, both providers**

With real credentials in `.env`, for **Google and then Apple**:

1. First sign-in creates a user and lands on `/home`.
2. Second sign-in returns the **same** user id from `/auth/me`.
3. `?next=/movie/<id>` returns there after sign-in.
4. Replaying a captured `/verify` request body gives a 400.
5. For Apple specifically: the display name is captured on the **first**
   authorization, and a second sign-in still works with no email in the token.

- [ ] **Step 4: Commit the verification record**

```bash
git commit --allow-empty -m "docs: record verification of the social login pass

flick-api <N> tests + e2e + lint green; flick-app <M> tests + lint + build
green; performance:check exit 0. Audited: no blanket P2002 catch, nothing
sensitive in a log line, unverified-email and nonce-replay rules covered by
test. Manual round trip confirmed against real Google and Apple
credentials, including Apple's first-authorization-only name and a repeat
sign-in carrying no email."
```

Replace `<N>` and `<M>` with the real counts. A record with placeholders in it is
not a record.

---

## Sequencing

| Task | Depends on | Why here |
|---|---|---|
| 1 — schema | — | Everything reads these models. |
| 2 — port + fake | — | The fake adapter unblocks 4-9 before a credential exists. |
| 3 — nonce | 1 | Needed by the controller; independent of the resolver. |
| 4 — resolver | 1, 2 | The security core. Deserves its own review gate. |
| 5 — concurrency | 4 | Same file; separated so the race handling is judged on its own. |
| 6 — Google adapter | 2 | Independent of 3-5. |
| 7 — Apple adapter | 2 | Independent of 6; both are pure claim mapping plus one jose call. |
| 8 — wiring | 6, 7 | Needs both adapters to exist to register them. |
| 9 — endpoints | 3, 5, 8 | The first task that produces a working login. |
| 10 — frontend client | 9 | Needs the endpoints. |
| 11 — login screen | 10 | Needs the client. |
| 12 — reaper | 1 | Independent of everything after Task 1; can run any time. |
| 13 — verification | all | Runs the gate CI runs. |

Tasks 6 and 7 are fully independent of each other and of 3-5, and 12 is
independent of everything after Task 1 — four places this plan parallelises.

---

## Not in this plan

- **Linking from an authenticated profile.** Spec §11. The schema supports it —
  that is what `@@unique([userId, provider])` is for — but the endpoint and UI
  are their own phase. It is also the answer for the Apple-relay user who ends
  up with two accounts (spec §8.4).
- **Unlinking**, which needs the rule "never remove the last credential".
- **Merging two existing accounts.**
- **LINE and Facebook.** One enum value, one adapter, one config block, one
  button each.
