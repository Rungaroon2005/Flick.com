# Google Social Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person sign in with Google and land in the same session an OTP
login produces, with identity stored in its own table so a further provider costs
one adapter.

**Architecture:** The Nest API owns the OAuth round trip. `/auth/oauth/google/start`
issues a single-use `OAuthState` row and redirects to Google; the callback
exchanges the code, validates the ID token, hands a provider-agnostic
`ProviderProfile` to `IdentityResolver`, and mints the existing `access_token`
cookie. Google is reached only through `OAuthProviderPort`, so the resolver never
learns a provider's name and Apple later costs one adapter plus one enum value.

**Tech Stack:** NestJS 11, Prisma 7.9 (PostgreSQL), `jose` for ID-token
verification, `@nestjs/schedule` for pruning, jest for the API, Next.js 16 +
vitest for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-01-social-login-design.md` — read it
first. This plan implements the Google phase of §10 only; Apple is a later plan.

## Global Constraints

Every task's requirements implicitly include this section.

- **Two new dependencies, both in `apps/flick-api`: `jose` and `@nestjs/schedule`** (spec §9.1).
  No others. A task that seems to need a third is a task that has been misread.
- **The session is not redesigned.** Social login mints the *existing* cookie via
  the existing `setTokenCookie` (`auth.controller.ts:38-46`) and the existing
  payload `{ sub: user.id, email: user.email }`. `JwtStrategy`, `JwtAuthGuard`,
  `RolesGuard` and the frontend's `getSession()` must not change.
- **Never auto-link on an unverified provider email** (spec §6.2 row 2). This is
  the assertion the feature's safety rests on.
- **Never write `User.email` without proof of control** (spec §11.1). Set
  `emailVerifiedAt` in the same statement, or leave the email null.
- **All UI copy is Thai.** The one new user-facing string is given verbatim in
  Task 9; do not translate or reword it.
- **`apps/flick-api` currently has 179 passing tests; `apps/flick-app` has 89.**
  Both numbers only go up.
- **Per-task gate, run before every commit:**
  ```bash
  cd apps/flick-api && npm test && npm run lint
  cd ../flick-app && npm test && npm run lint
  ```
- **No secret ever reaches a log, a URL, or a response body.** Not the code, not
  the state, not the client secret, not the token.

---

## File Structure

All API paths are relative to `apps/flick-api/src/`.

| File | Change | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | `Identity`, `OAuthState`, `IdentityProvider`, `User.emailVerifiedAt` |
| `prisma/migrations/<ts>_social_login/migration.sql` | Create | Tables + the email backfill |
| `testing/prisma.mock.ts` | Modify | Adds `identity` and `oAuthState` mocks |
| `auth/oauth/oauth-provider.port.ts` | Create | `OAuthProviderPort`, `ProviderProfile`, the DI token |
| `auth/oauth/adapters/fake-provider.adapter.ts` | Create | Deterministic adapter for tests and e2e |
| `auth/oauth/adapters/google-provider.adapter.ts` | Create | Google discovery, PKCE, JWKS, ID-token validation |
| `auth/oauth/oauth-state.service.ts` | Create | Issue and single-use consume of `OAuthState` |
| `auth/oauth/identity-resolver.ts` | Create | The spec §6.2 decision table. No HTTP, no provider knowledge |
| `auth/oauth/oauth.controller.ts` | Create | `/start`, `/google/callback`, `/providers` |
| `auth/oauth/safe-redirect.ts` | Create | Server-side port of `lib/nextParam.ts`'s allowlist |
| `auth/oauth/oauth.module.ts` | Create | Provider registry from config |
| `common/config.validation.ts` | Modify | Fail closed on a half-configured provider |
| `maintenance/prune.service.ts` | Create | The scheduled reaper (spec §9) |
| `app.module.ts` | Modify | Register `OAuthModule`, `ScheduleModule`, `MaintenanceModule` |

Frontend paths relative to `apps/flick-app/src/`.

| File | Change | Responsibility |
|---|---|---|
| `types/api.ts` | Modify | `/auth/oauth/providers` in `ApiPath`, `ApiResponse`, `decodeApiResponse` |
| `features/auth/oauth.ts` | Create | `fetchOAuthProviders()`, `oauthStartUrl()` |
| `app/login/page.tsx` | Modify | Google button, and the §6.3 conflict message |

### Component checklist

- [ ] Schema + migration + backfill + prisma mock (Task 1)
- [ ] `OAuthProviderPort` / `ProviderProfile` / `FakeOAuthProviderAdapter` (Task 2)
- [ ] `OAuthStateService` (Task 3)
- [ ] `IdentityResolver` — the §6.2 table (Task 4)
- [ ] `IdentityResolver` concurrency — P2002 as a retry signal (Task 5)
- [ ] `GoogleProviderAdapter` (Task 6)
- [ ] Registry, module wiring, config validation (Task 7)
- [ ] `OAuthController` + `safeRedirectPath` + e2e (Task 8)
- [ ] Frontend button, providers endpoint, conflict copy (Task 9)
- [ ] Scheduled reaper (Task 10)
- [ ] Whole-pass verification (Task 11)

---

## Task 1: Schema, migration, and the email backfill

**Files:**
- Modify: `apps/flick-api/prisma/schema.prisma`
- Create: `apps/flick-api/prisma/migrations/<timestamp>_social_login/migration.sql`
- Modify: `apps/flick-api/src/testing/prisma.mock.ts`

**Interfaces:**
- Produces: Prisma models `Identity`, `OAuthState`; enum `IdentityProvider`;
  `User.emailVerifiedAt`. Client accessors are **`prisma.identity`** and
  **`prisma.oAuthState`** — Prisma lowercases only the first character, so
  `OAuthState` becomes `oAuthState`, not `oauthState`. Every later task uses
  those exact names.

**Context:** Spec §4. Additive only: two tables, one enum, one nullable column.
The backfill is the one piece of data work, and skipping it would send every
existing email user into the §6.3 refusal on their first Google sign-in.

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

and add to its relation list, beside `subscriptions`:

```prisma
  identities Identity[]
```

Then add both models:

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

  /// The login key, and the race guard: concurrent first-time callbacks collide
  /// here rather than creating two users. See Task 5.
  @@unique([provider, providerAccountId])
  /// One identity per provider per user; stops a retry accumulating duplicates.
  @@unique([userId, provider])
  @@index([userId])
  @@map("identities")
}

model OAuthState {
  id           String           @id @default(uuid())
  /// Random, single-use, sent to the provider as `state`.
  state        String           @unique
  /// OIDC replay guard, echoed back inside the ID token.
  nonce        String
  /// PKCE verifier; its S256 challenge goes to the provider.
  codeVerifier String
  provider     IdentityProvider
  /// Where to send the browser afterwards. Allowlisted BEFORE it is stored.
  redirectPath String           @default("/home")

  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  consumedAt DateTime?

  @@index([expiresAt])
  @@map("oauth_states")
}
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/flick-api && npx prisma migrate dev --name social_login --create-only
```

`--create-only` writes the SQL without applying it, so Step 3 can add the
backfill before anything runs.

- [ ] **Step 3: Append the backfill to the generated SQL**

Open the new `prisma/migrations/<timestamp>_social_login/migration.sql` and add
at the end:

```sql
-- Every existing users.email was proven by OTP delivery: the only write is in
-- OtpService.verify, reachable only by receiving a code at that address. This
-- states that existing fact rather than asserting a new one. Without it, every
-- current email user would hit the "refuse to auto-link" branch on their first
-- Google sign-in.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "email" IS NOT NULL;
```

- [ ] **Step 4: Apply it and regenerate the client**

```bash
cd apps/flick-api && npx prisma migrate dev && npx prisma generate
```

Expected: migration applies, client regenerates with `IdentityProvider`,
`prisma.identity` and `prisma.oAuthState`.

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
  oAuthState: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
```

and to the object returned by `createPrismaMock`:

```typescript
    identity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    oAuthState: {
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

Expected: 179 passing, unchanged. This task adds no tests — it adds no
behaviour. The migration is exercised by CI's `migrate:deploy`.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/prisma/schema.prisma \
        apps/flick-api/prisma/migrations \
        apps/flick-api/src/testing/prisma.mock.ts
git commit -m "feat(auth): add Identity and OAuthState models

Moves identity off the User row: a User becomes a profile and an
entitlement holder, and Identity rows say how that person can prove they
are themselves. OAuthState carries the single-use OAuth state, nonce and
PKCE verifier in the database rather than a cookie, because Apple's
form_post callback is a cross-site POST that SameSite=Lax cookies do not
survive.

The migration backfills emailVerifiedAt from createdAt for every existing
email. That states an existing fact -- the only write of User.email is
inside OtpService.verify, reachable only by receiving a code at that
address -- and without it every current email user would hit the
refuse-to-auto-link branch on their first Google sign-in."
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
  export const OAUTH_PROVIDER_REGISTRY: unique symbol-like string token
  export interface ProviderProfile {
    providerAccountId: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string | null;
    avatarUrl: string | null;
  }
  export interface AuthorizationRequest {
    state: string; nonce: string; codeChallenge: string; redirectUri: string;
  }
  export interface ExchangeRequest {
    code: string; codeVerifier: string; nonce: string; redirectUri: string;
  }
  export interface OAuthProviderPort {
    readonly id: IdentityProvider;
    buildAuthorizationUrl(request: AuthorizationRequest): string;
    exchange(request: ExchangeRequest): Promise<ProviderProfile>;
  }
  ```
  Tasks 4-8 depend on these names exactly.

**Context:** Spec §5. `ProviderProfile` is the only shape the resolver sees, which
is what keeps Apple's quirks out of the linking logic. The fake adapter exists so
Tasks 4-8 can be built and e2e-tested before any Google credential exists —
the same role `FakeGatewayAdapter` plays for payments.

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

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface ExchangeRequest {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}

export interface OAuthProviderPort {
  readonly id: IdentityProvider;
  buildAuthorizationUrl(request: AuthorizationRequest): string;
  /** Rejects if the code is bad or the ID token fails validation. */
  exchange(request: ExchangeRequest): Promise<ProviderProfile>;
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

  const request = {
    state: 'st_1',
    nonce: 'no_1',
    codeChallenge: 'ch_1',
    redirectUri: 'https://api.test/auth/oauth/google/callback',
  };

  it('round-trips state through the authorization url', () => {
    expect(adapter.buildAuthorizationUrl(request)).toContain('state=st_1');
  });

  it('decodes a profile from the code so tests can choose one', async () => {
    const code = FakeOAuthProviderAdapter.encode({
      providerAccountId: 'sub_1',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: null,
    });

    await expect(
      adapter.exchange({ ...request, code, codeVerifier: 'v' }),
    ).resolves.toMatchObject({ providerAccountId: 'sub_1', emailVerified: true });
  });

  it('rejects a code it did not mint', async () => {
    await expect(
      adapter.exchange({ ...request, code: 'not-a-real-code', codeVerifier: 'v' }),
    ).rejects.toThrow(/invalid code/i);
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
import type {
  AuthorizationRequest,
  ExchangeRequest,
  OAuthProviderPort,
  ProviderProfile,
} from '../oauth-provider.port';

/**
 * Deterministic provider for tests and e2e, mirroring FakeGatewayAdapter's role
 * in payments: it lets the whole callback path be exercised without a network
 * call or a real credential. The code IS the profile, base64url-encoded, so a
 * test can choose exactly which linking branch it drives.
 *
 * config.validation.ts refuses to let this be selected in production.
 */
export class FakeOAuthProviderAdapter implements OAuthProviderPort {
  constructor(readonly id: IdentityProvider) {}

  static encode(profile: ProviderProfile): string {
    return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
  }

  buildAuthorizationUrl(request: AuthorizationRequest): string {
    const params = new URLSearchParams({
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      redirect_uri: request.redirectUri,
    });
    return `https://fake-provider.test/authorize?${params.toString()}`;
  }

  exchange(request: ExchangeRequest): Promise<ProviderProfile> {
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        Buffer.from(request.code, 'base64url').toString('utf8'),
      );
    } catch {
      return Promise.reject(new Error('Fake provider: invalid code'));
    }

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as ProviderProfile).providerAccountId !== 'string'
    ) {
      return Promise.reject(new Error('Fake provider: invalid code'));
    }
    return Promise.resolve(decoded as ProviderProfile);
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

ProviderProfile is the only shape IdentityResolver will ever see, which is
what keeps a provider's quirks -- Apple's string email_verified, its relay
addresses -- out of the linking rules. The fake adapter encodes the profile
into the code itself, so every branch of the resolver and the whole callback
path can be driven in tests before a Google credential exists, the same role
FakeGatewayAdapter plays for payments."
```

---

## Task 3: `OAuthStateService`

**Files:**
- Create: `apps/flick-api/src/auth/oauth/oauth-state.service.ts`
- Test: `apps/flick-api/src/auth/oauth/oauth-state.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.oAuthState` (Task 1).
- Produces:
  ```typescript
  export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  export interface IssuedState {
    state: string; nonce: string; codeVerifier: string; codeChallenge: string;
  }
  class OAuthStateService {
    issue(provider: IdentityProvider, redirectPath: string): Promise<IssuedState>
    consume(state: string, provider: IdentityProvider): Promise<{ nonce: string; codeVerifier: string; redirectPath: string }>
  }
  ```
  `consume` throws `BadRequestException` for unknown, expired, wrong-provider or
  already-consumed states.

**Context:** Spec §4.3. Single-use via a `consumedAt` guard, exactly as
`OtpService.verify` burns a challenge (`otp.service.ts:273-279`): the guarded
`updateMany` matching zero rows *is* the replay detection, because a
read-then-write check would race.

- [ ] **Step 1: Write the failing tests**

Create `apps/flick-api/src/auth/oauth/oauth-state.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { OAuthStateService } from './oauth-state.service';
import { PrismaService } from '../../prisma.service';
import { createPrismaMock } from '../../testing/prisma.mock';

describe('OAuthStateService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: OAuthStateService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.oAuthState.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'os_1', ...args.data }),
    );
    service = new OAuthStateService(prisma as unknown as PrismaService);
  });

  const live = (overrides = {}) => ({
    id: 'os_1',
    state: 'st_1',
    nonce: 'no_1',
    codeVerifier: 'ver_1',
    provider: IdentityProvider.GOOGLE,
    redirectPath: '/home',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  });

  it('issues unguessable values and stores them', async () => {
    const issued = await service.issue(IdentityProvider.GOOGLE, '/movie/abc');

    expect(issued.state.length).toBeGreaterThanOrEqual(32);
    expect(issued.nonce.length).toBeGreaterThanOrEqual(32);
    expect(issued.codeVerifier.length).toBeGreaterThanOrEqual(43); // PKCE floor

    const created = prisma.oAuthState.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.redirectPath).toBe('/movie/abc');
    expect(created.data.provider).toBe(IdentityProvider.GOOGLE);
  });

  it('derives the PKCE challenge as S256 of the verifier, never the verifier itself', async () => {
    const issued = await service.issue(IdentityProvider.GOOGLE, '/home');

    // Sending the raw verifier to the provider would defeat PKCE entirely.
    expect(issued.codeChallenge).not.toBe(issued.codeVerifier);
    expect(issued.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('consumes a live state exactly once', async () => {
    prisma.oAuthState.findUnique.mockResolvedValue(live());
    prisma.oAuthState.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.consume('st_1', IdentityProvider.GOOGLE),
    ).resolves.toMatchObject({ nonce: 'no_1', redirectPath: '/home' });
  });

  it('rejects a replay whose consuming update matches zero rows', async () => {
    prisma.oAuthState.findUnique.mockResolvedValue(live());
    // A concurrent callback burned it between our read and our write.
    prisma.oAuthState.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consume('st_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an expired state', async () => {
    prisma.oAuthState.findUnique.mockResolvedValue(
      live({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      service.consume('st_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.oAuthState.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a state issued for a different provider', async () => {
    prisma.oAuthState.findUnique.mockResolvedValue(
      live({ provider: IdentityProvider.APPLE }),
    );

    await expect(
      service.consume('st_1', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown state', async () => {
    prisma.oAuthState.findUnique.mockResolvedValue(null);

    await expect(
      service.consume('nope', IdentityProvider.GOOGLE),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest oauth-state.service.spec
```

Expected: FAIL — `Cannot find module './oauth-state.service'`.

- [ ] **Step 3: Write the service**

Create `apps/flick-api/src/auth/oauth/oauth-state.service.ts`:

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** One message for every failure mode: unknown, expired, wrong provider, replayed. */
const INVALID_STATE = 'คำขอเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ (Invalid or expired login request)';

export interface IssuedState {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** S256(codeVerifier). This is what goes to the provider, never the verifier. */
  codeChallenge: string;
}

export interface ConsumedState {
  nonce: string;
  codeVerifier: string;
  redirectPath: string;
}

const randomToken = () => randomBytes(32).toString('base64url');

@Injectable()
export class OAuthStateService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    provider: IdentityProvider,
    redirectPath: string,
  ): Promise<IssuedState> {
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    await this.prisma.oAuthState.create({
      data: {
        state,
        nonce,
        codeVerifier,
        provider,
        redirectPath,
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });

    return { state, nonce, codeVerifier, codeChallenge };
  }

  /**
   * Burns the state and returns what the callback needs. The guarded updateMany
   * IS the single-use mechanism: two concurrent callbacks both read a live row,
   * and the second matches zero rows once the first commits. A read-then-write
   * check would race. Same pattern as OtpService.verify.
   */
  async consume(
    state: string,
    provider: IdentityProvider,
  ): Promise<ConsumedState> {
    const row = await this.prisma.oAuthState.findUnique({ where: { state } });

    if (
      !row ||
      row.provider !== provider ||
      row.consumedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(INVALID_STATE);
    }

    const burned = await this.prisma.oAuthState.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (burned.count === 0) throw new BadRequestException(INVALID_STATE);

    return {
      nonce: row.nonce,
      codeVerifier: row.codeVerifier,
      redirectPath: row.redirectPath,
    };
  }
}
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest oauth-state.service.spec
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/oauth/oauth-state.service.ts \
        apps/flick-api/src/auth/oauth/oauth-state.service.spec.ts
git commit -m "feat(auth): add single-use OAuth state with PKCE

State, nonce and PKCE verifier live in the database rather than a cookie,
so the same code path will work for Apple's cross-site form_post callback
that SameSite=Lax cookies do not survive. Single-use is enforced by a
guarded updateMany on consumedAt: null -- two concurrent callbacks both
read a live row and the second matches zero rows, the same mechanism
OtpService.verify uses to burn a challenge. A read-then-write check would
race. One identical message for unknown, expired, wrong-provider and
replayed states."
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
  export interface ResolvedIdentity {
    userId: string; isNewUser: boolean; linked: boolean;
  }
  class IdentityResolver {
    resolve(provider: IdentityProvider, profile: ProviderProfile): Promise<ResolvedIdentity>
  }
  ```
  Throws `ConflictException` for the §6.3 refusal and `UnauthorizedException`
  for a soft-deleted user. Task 8 consumes both.

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

    // 2. No usable email: nothing to match on, so this is a new person.
    //    An UNVERIFIED email lands here too, and that is the point — matching on
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

**Context:** Spec §7. A double-clicked button, or a provider retry, runs `resolve`
twice concurrently for one `providerAccountId`. **The transaction in Task 4 does
not prevent the duplicate** — under READ COMMITTED both reads see no identity and
both insert. `@@unique([provider, providerAccountId])` is what serializes them:
one insert wins, the other raises `P2002`. The loser must re-read and succeed, so
a double-click produces two logins rather than one login and one error.

The `P2002` catch must be narrowed to that one constraint. A blanket catch is the
exact defect the 2026-09-01 review found in `PaymentsService` and
`2026-09-01-security-hardening.md` Task 3 repairs. Do not reintroduce it here.

- [ ] **Step 1: Write the failing tests**

Add to `apps/flick-api/src/auth/oauth/identity-resolver.spec.ts`:

```typescript
  const uniqueViolation = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it('treats a concurrent first login as a login, not an error', async () => {
    // Both callbacks read "no identity"; the other one won the insert.
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

Add `Prisma` to the `@prisma/client` import at the top of the spec.

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest identity-resolver.spec -t "concurrent"
```

Expected: FAIL — the P2002 escapes `resolve` instead of being retried.

- [ ] **Step 3: Add the retry**

In `apps/flick-api/src/auth/oauth/identity-resolver.ts`, add above the class:

```typescript
/**
 * Which unique constraint means "a concurrent callback for this same provider
 * account beat us to it"? Only the identity key. Matched by substring because
 * Prisma reports meta.target as either column names or a constraint name.
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

Then wrap the two write paths. Replace the body of `createUser`'s transaction
call and the row-5 link with a shared helper — add this private method:

```typescript
  /**
   * Runs a write that may lose the race on [provider, providerAccountId]. The
   * loser is not an error: the winner has created exactly the identity we were
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

and wrap `createUser`'s transaction by changing its body to:

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
git commit -m "feat(auth): treat a concurrent first login as a login

A transaction gives atomicity, not mutual exclusion: under READ COMMITTED
two concurrent callbacks for the same provider account both read 'no
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
- Consumes: `OAuthProviderPort`, `ProviderProfile` (Task 2).
- Produces: `class GoogleProviderAdapter implements OAuthProviderPort`,
  constructed as `new GoogleProviderAdapter(config: ConfigService)`.

**Context:** Spec §9.1 for why `jose`. Google's ID token is an RS256 JWT signed
with a rotating key published at a JWKS endpoint; `createRemoteJWKSet` handles
fetching, caching and `kid` selection. `iss`, `aud`, `exp` and `nonce` must all
be checked — a token that is merely well-signed but issued for a different client
is not a login.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/flick-api && npm install jose
```

- [ ] **Step 2: Write the failing tests**

Create `apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { GoogleProviderAdapter } from './google-provider.adapter';

describe('GoogleProviderAdapter', () => {
  const config = {
    getOrThrow: (key: string) =>
      ({
        GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'client-secret',
      })[key],
  } as unknown as ConfigService;

  const adapter = new GoogleProviderAdapter(config);

  const request = {
    state: 'st_1',
    nonce: 'no_1',
    codeChallenge: 'ch_1',
    redirectUri: 'https://api.test/auth/oauth/google/callback',
  };

  it('is the Google provider', () => {
    expect(adapter.id).toBe(IdentityProvider.GOOGLE);
  });

  it('builds an authorization url with PKCE and the openid scopes', () => {
    const url = new URL(adapter.buildAuthorizationUrl(request));

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st_1');
    expect(url.searchParams.get('nonce')).toBe('no_1');
    expect(url.searchParams.get('code_challenge')).toBe('ch_1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('never puts the client secret in the authorization url', () => {
    expect(adapter.buildAuthorizationUrl(request)).not.toContain('client-secret');
  });

  it('maps a verified Google claim set to a profile', () => {
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
    // Apple sends this field as a string and Google's contract is not worth
    // trusting on the point either: only a real true is verified.
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

  it('rejects a claim set with no subject', () => {
    expect(() => GoogleProviderAdapter.toProfile({ email: 'a@example.com' })).toThrow(
      /sub/,
    );
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
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type {
  AuthorizationRequest,
  ExchangeRequest,
  OAuthProviderPort,
  ProviderProfile,
} from '../oauth-provider.port';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const REQUEST_TIMEOUT_MS = 8000;

/** Only a real boolean true, or the exact string "true", counts as verified. */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

@Injectable()
export class GoogleProviderAdapter implements OAuthProviderPort {
  readonly id = IdentityProvider.GOOGLE;
  private readonly logger = new Logger('GoogleProvider');
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly config: ConfigService) {}

  buildAuthorizationUrl(request: AuthorizationRequest): string {
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      redirect_uri: request.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  async exchange(request: ExchangeRequest): Promise<ProviderProfile> {
    const body = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      code: request.code,
      code_verifier: request.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: request.redirectUri,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Never log the body: it echoes the code and the client secret back.
      this.logger.error(`Google token exchange failed (HTTP ${response.status})`);
      throw new Error('Google token exchange failed');
    }

    const payload = (await response.json()) as { id_token?: unknown };
    if (typeof payload.id_token !== 'string') {
      throw new Error('Google response carried no id_token');
    }

    // Signature, issuer, audience and expiry. A well-signed token issued for a
    // different client is not a login here.
    const { payload: claims } = await jwtVerify(payload.id_token, this.jwks, {
      issuer: ISSUERS,
      audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
    });

    if (claims.nonce !== request.nonce) {
      throw new Error('Google id_token nonce did not match the request');
    }

    return GoogleProviderAdapter.toProfile(claims);
  }

  /** Pure claim-set → profile mapping, exported so it can be tested directly. */
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

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/package.json apps/flick-api/package-lock.json \
        apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.ts \
        apps/flick-api/src/auth/oauth/adapters/google-provider.adapter.spec.ts
git commit -m "feat(auth): add the Google OIDC provider adapter

Adds jose, because validating an ID token means fetching a rotating JWKS
and verifying RS256, and @nestjs/jwt only does HS256 against our own
secret. createRemoteJWKSet handles fetch, cache and kid selection.

The token is checked for signature, issuer, audience and nonce -- a
well-signed token issued for a different client is not a login. Only a real
true or the exact string 'true' counts as a verified email, so a provider
sending the string 'false' cannot be read as truthy and slip past the rule
that an unverified email is never matched to an existing account."
```

---

## Task 7: Registry, module wiring, and fail-closed config

**Files:**
- Create: `apps/flick-api/src/auth/oauth/oauth.module.ts`
- Modify: `apps/flick-api/src/common/config.validation.ts`
- Modify: `apps/flick-api/src/common/config.validation.spec.ts`
- Modify: `apps/flick-api/.env.example`

**Interfaces:**
- Consumes: `OAUTH_PROVIDER_REGISTRY`, `OAuthProviderRegistry` (Task 2),
  `GoogleProviderAdapter` (Task 6), `FakeOAuthProviderAdapter` (Task 2).
- Produces: `createOAuthProviderRegistry(config: ConfigService): OAuthProviderRegistry`,
  exported for direct unit testing — the same shape as `createOtpDeliveryPort`
  in `otp.module.ts:15`.

**Context:** `config.validation.ts` already refuses to boot production with a
console OTP adapter or a fake payment gateway (`:27-31`, `:47-51`). A provider
listed in `OAUTH_PROVIDERS` without its credentials, or the fake adapter in
production, belongs in that list: a half-configured provider otherwise shows a
button that dead-ends.

- [ ] **Step 1: Write the failing config tests**

`config.validation.spec.ts:4-8` defines `base`. Add the tests:

```typescript
  it('accepts oauth being switched off entirely', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', OTP_DELIVERY: 'console' }),
    ).not.toThrow();
  });

  it('refuses a provider listed without its credentials', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        OTP_DELIVERY: 'console',
        OAUTH_PROVIDERS: 'google',
      }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
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

Note: these production tests must carry every variable production already
demands. If `2026-09-01-security-hardening.md` Task 5 has landed, a
`productionBase` helper exists — use it instead of repeating the literal.

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest config.validation.spec
```

Expected: the three refusal tests FAIL (nothing throws today).

- [ ] **Step 3: Add the rules**

In `apps/flick-api/src/common/config.validation.ts`, add before `return config;`:

```typescript
  const KNOWN_OAUTH_PROVIDERS: Record<string, string[]> = {
    google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
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
        'OAUTH_PROVIDERS must not include "fake" in production — it accepts any self-minted code and would hand out sessions',
      );
    }
    const missing = required.filter((key) => !config[key]);
    if (missing.length > 0) {
      throw new Error(
        `OAUTH_PROVIDERS includes "${name}" but is missing: ${missing.join(', ')}`,
      );
    }
  }

  if (oauthProviders.length > 0 && isProduction) {
    const base = String(config.OAUTH_REDIRECT_BASE_URL ?? '');
    if (!base.startsWith('https://')) {
      throw new Error(
        'OAUTH_REDIRECT_BASE_URL must be an https:// URL in production',
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
import { OAUTH_PROVIDER_REGISTRY, type OAuthProviderRegistry } from './oauth-provider.port';
import { GoogleProviderAdapter } from './adapters/google-provider.adapter';
import { FakeOAuthProviderAdapter } from './adapters/fake-provider.adapter';
import { OAuthStateService } from './oauth-state.service';
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
  if (enabled.includes('fake')) {
    registry.set(IdentityProvider.GOOGLE, new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE));
  }
  return registry;
}

@Module({
  imports: [ConfigModule],
  providers: [
    OAuthStateService,
    IdentityResolver,
    {
      provide: OAUTH_PROVIDER_REGISTRY,
      inject: [ConfigService],
      useFactory: createOAuthProviderRegistry,
    },
  ],
  exports: [OAuthStateService, IdentityResolver, OAUTH_PROVIDER_REGISTRY],
})
export class OAuthModule {}
```

- [ ] **Step 5: Document the variables**

Add to `apps/flick-api/.env.example`, below the OTP block:

```bash
# Social login. Comma-separated; empty or unset disables the feature entirely.
# "fake" is a test-only adapter that accepts any self-minted code and is
# refused in production.
# OAUTH_PROVIDERS=google
# OAUTH_REDIRECT_BASE_URL=http://localhost:3001   # must be https in production
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
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

A provider listed in OAUTH_PROVIDERS without its credentials is now a boot
failure rather than a button that dead-ends, an unknown provider name is
refused outright, and the fake adapter -- which accepts any self-minted
code -- cannot be selected in production. Same fail-closed treatment
config.validation already gives the console OTP adapter and the fake
payment gateway. An unset OAUTH_PROVIDERS disables the feature entirely."
```

---

## Task 8: The HTTP surface

**Files:**
- Create: `apps/flick-api/src/auth/oauth/safe-redirect.ts`
- Create: `apps/flick-api/src/auth/oauth/safe-redirect.spec.ts`
- Create: `apps/flick-api/src/auth/oauth/oauth.controller.ts`
- Create: `apps/flick-api/src/auth/oauth/oauth.controller.spec.ts`
- Create: `apps/flick-api/test/oauth.e2e-spec.ts`
- Modify: `apps/flick-api/src/app.module.ts`

**Interfaces:**
- Consumes: `OAuthStateService`, `IdentityResolver`, `OAUTH_PROVIDER_REGISTRY`.
- Produces: `GET /auth/oauth/providers`, `GET /auth/oauth/:provider/start`,
  `GET /auth/oauth/google/callback`.

**Context:** Spec §6.4 and §6.5. Session issuance reuses `setTokenCookie`
verbatim. `safeRedirectPath` ports the allowlist from `lib/nextParam.ts`: an
OAuth callback that redirects anywhere is an open redirect.

- [ ] **Step 1: Write the failing redirect tests**

Create `apps/flick-api/src/auth/oauth/safe-redirect.spec.ts`:

```typescript
import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath', () => {
  it.each(['/home', '/movie/abc', '/subscribe?plan=monthly'])(
    'allows the in-app path %s',
    (path) => expect(safeRedirectPath(path)).toBe(path),
  );

  it.each([
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash authority'],
    ['https://evil.com', 'absolute url'],
    ['/home\nSet-Cookie: x=y', 'header injection'],
    ['/home\tx', 'tab'],
    ['', 'empty'],
  ])('falls back to /home for %s (%s)', (path) => {
    expect(safeRedirectPath(path)).toBe('/home');
  });

  it('falls back to /home for null', () => {
    expect(safeRedirectPath(null)).toBe('/home');
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd apps/flick-api && npx jest safe-redirect.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

Create `apps/flick-api/src/auth/oauth/safe-redirect.ts`:

```typescript
export const DEFAULT_REDIRECT_PATH = '/home';

/**
 * Server-side twin of the frontend's safeNext (apps/flick-app/src/lib/nextParam.ts).
 * A callback that will redirect anywhere is an open redirect, so this allowlists
 * rather than sanitises: one leading slash, never two, no backslash (browsers
 * normalise \ to / in the authority position), and no control characters (URL
 * parsers strip tab, CR and LF before parsing, so a value containing them does
 * not navigate to the value we checked).
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT_PATH;
  if (/[\t\r\n]/.test(raw)) return DEFAULT_REDIRECT_PATH;
  if (!raw.startsWith('/')) return DEFAULT_REDIRECT_PATH;
  if (raw.startsWith('//')) return DEFAULT_REDIRECT_PATH;
  if (raw.startsWith('/\\')) return DEFAULT_REDIRECT_PATH;
  return raw;
}
```

- [ ] **Step 4: Write the failing controller tests**

Create `apps/flick-api/src/auth/oauth/oauth.controller.spec.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { OAuthController } from './oauth.controller';
import { FakeOAuthProviderAdapter } from './adapters/fake-provider.adapter';
import type { OAuthProviderRegistry } from './oauth-provider.port';

describe('OAuthController', () => {
  let controller: OAuthController;
  let state: { issue: jest.Mock; consume: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let res: { cookie: jest.Mock; redirect: jest.Mock };

  const registry: OAuthProviderRegistry = new Map([
    [IdentityProvider.GOOGLE, new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE)],
  ]);

  beforeEach(() => {
    state = {
      issue: jest.fn().mockResolvedValue({
        state: 'st_1', nonce: 'no_1', codeVerifier: 'v', codeChallenge: 'c',
      }),
      consume: jest.fn().mockResolvedValue({
        nonce: 'no_1', codeVerifier: 'v', redirectPath: '/home',
      }),
    };
    resolver = { resolve: jest.fn().mockResolvedValue({ userId: 'u1', isNewUser: false, linked: false }) };
    jwt = { signAsync: jest.fn().mockResolvedValue('tok') };
    res = { cookie: jest.fn(), redirect: jest.fn() };

    controller = new OAuthController(
      registry,
      state as never,
      resolver as never,
      jwt as never,
      { get: (_k: string, d?: string) => d ?? 'http://localhost:3000' } as never,
    );
  });

  it('lists only configured providers', () => {
    expect(controller.providers()).toEqual({ providers: ['google'] });
  });

  it('404s an unconfigured provider rather than guessing', async () => {
    await expect(controller.start('apple', undefined, res as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('allowlists the redirect path before storing it', async () => {
    await controller.start('google', 'https://evil.com', res as never);

    expect(state.issue).toHaveBeenCalledWith(IdentityProvider.GOOGLE, '/home');
  });

  it('sets the session cookie and never puts the token in the url', async () => {
    const code = FakeOAuthProviderAdapter.encode({
      providerAccountId: 'sub_1', email: 'a@example.com',
      emailVerified: true, displayName: 'A', avatarUrl: null,
    });

    await controller.callback('google', code, 'st_1', res as never);

    expect(res.cookie).toHaveBeenCalledWith('access_token', 'tok', expect.objectContaining({ httpOnly: true }));
    const [destination] = res.redirect.mock.calls[0] as [string];
    expect(destination).not.toContain('tok');
  });

  it('rejects a callback with no state', async () => {
    await expect(
      controller.callback('google', 'code', '', res as never),
    ).rejects.toThrow(BadRequestException);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('sends the refuse-to-link case back to the login screen, not a bare 409', async () => {
    resolver.resolve.mockRejectedValue(new ConflictException('claimed'));
    const code = FakeOAuthProviderAdapter.encode({
      providerAccountId: 'sub_1', email: 'a@example.com',
      emailVerified: true, displayName: 'A', avatarUrl: null,
    });

    // The person is mid-redirect in a browser; a 409 body is a dead end.
    await controller.callback('google', code, 'st_1', res as never);

    const [destination] = res.redirect.mock.calls[0] as [string];
    expect(destination).toContain('/login?error=email_claimed');
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest oauth.controller.spec
```

Expected: FAIL — module not found.

- [ ] **Step 6: Write the controller**

Create `apps/flick-api/src/auth/oauth/oauth.controller.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IdentityProvider } from '@prisma/client';
import type { Response } from 'express';
import ms from 'ms';
import { Public } from '../public.decorator';
import { DEFAULT_JWT_EXPIRES_IN } from '../jwt.config';
import {
  OAUTH_PROVIDER_REGISTRY,
  type OAuthProviderRegistry,
} from './oauth-provider.port';
import { OAuthStateService } from './oauth-state.service';
import { IdentityResolver, type ResolvedIdentity } from './identity-resolver';
import { safeRedirectPath } from './safe-redirect';

/** provider path segment → enum. Unknown segments 404 rather than guess. */
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
    private readonly state: OAuthStateService,
    private readonly resolver: IdentityResolver,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.tokenMaxAge = ms(
      this.config.get<string>('JWT_EXPIRES_IN', DEFAULT_JWT_EXPIRES_IN) as ms.StringValue,
    );
  }

  /** Lets the login screen render only buttons that will work. */
  @Public()
  @Get('providers')
  providers(): { providers: string[] } {
    return {
      providers: [...this.registry.keys()].map((id) => id.toLowerCase()),
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Query('next') next: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const adapter = this.adapterFor(provider);
    // Allowlisted BEFORE it is stored, so nothing downstream has to remember to.
    const issued = await this.state.issue(adapter.id, safeRedirectPath(next));

    res.redirect(
      adapter.buildAuthorizationUrl({
        state: issued.state,
        nonce: issued.nonce,
        codeChallenge: issued.codeChallenge,
        redirectUri: this.redirectUri(provider),
      }),
    );
  }

  // `:provider`, not `google`, so Apple's later POST callback reuses every line
  // below it. Apple needs its own @Post route because it returns via form_post.
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!code || !state) throw new BadRequestException('Missing code or state');

    const adapter = this.adapterFor(provider);
    const consumed = await this.state.consume(state, adapter.id);

    const profile = await adapter.exchange({
      code,
      codeVerifier: consumed.codeVerifier,
      nonce: consumed.nonce,
      redirectUri: this.redirectUri(provider),
    });

    let resolved: ResolvedIdentity;
    try {
      resolved = await this.resolver.resolve(adapter.id, profile);
    } catch (err) {
      // The refuse-to-auto-link case (spec §6.3). A bare 409 here is a dead end
      // in the browser: the person is mid-redirect and has no way to read it.
      // Send them back to the login screen, which renders the explanation.
      if (err instanceof ConflictException) {
        return res.redirect(`${this.appBaseUrl()}/login?error=email_claimed`);
      }
      throw err;
    }

    const token = await this.jwt.signAsync({
      sub: resolved.userId,
      email: profile.email,
    });

    // Same cookie the OTP flow sets — see auth.controller.ts:38-46. Social login
    // is a second way to mint the existing session, not a second session.
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.tokenMaxAge,
    });

    // The redirect carries a destination, never a credential.
    res.redirect(`${this.appBaseUrl()}${consumed.redirectPath}`);
  }

  private appBaseUrl(): string {
    return this.config.get<string>('APP_BASE_URL', 'http://localhost:3000');
  }

  private adapterFor(provider: string) {
    const id = PROVIDER_IDS[provider?.toLowerCase()];
    const adapter = id ? this.registry.get(id) : undefined;
    if (!adapter) throw new NotFoundException('Unknown or unconfigured provider');
    return adapter;
  }

  private redirectUri(provider: string): string {
    const base = this.config.get<string>(
      'OAUTH_REDIRECT_BASE_URL',
      'http://localhost:3001',
    );
    return `${base}/auth/oauth/${provider}/callback`;
  }
}
```

Register it in `apps/flick-api/src/app.module.ts`: import `OAuthModule`, add it
to `imports`, and add `OAuthController` to `controllers`. `JwtModule` must be
available — import it the same way `AuthModule` does.

- [ ] **Step 7: Write the e2e test**

Create `apps/flick-api/test/oauth.e2e-spec.ts` following the shape of
`test/auth.e2e-spec.ts` (boot the app with `OAUTH_PROVIDERS=fake`, use
`supertest`). Cover, at minimum:

```typescript
  it('creates a user and sets a session cookie on first login', async () => {
    const start = await request(app.getHttpServer())
      .get('/auth/oauth/google/start')
      .expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');

    const code = FakeOAuthProviderAdapter.encode({
      providerAccountId: 'sub_e2e', email: 'e2e-oauth@flick.test',
      emailVerified: true, displayName: 'E2E', avatarUrl: null,
    });

    const callback = await request(app.getHttpServer())
      .get(`/auth/oauth/google/callback?code=${code}&state=${state}`)
      .expect(302);

    expect(callback.headers['set-cookie'][0]).toContain('access_token=');
    expect(callback.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('refuses to replay a consumed state', async () => {
    const start = await request(app.getHttpServer())
      .get('/auth/oauth/google/start')
      .expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    const code = FakeOAuthProviderAdapter.encode({
      providerAccountId: 'sub_replay', email: null,
      emailVerified: false, displayName: null, avatarUrl: null,
    });
    const url = `/auth/oauth/google/callback?code=${code}&state=${state}`;

    await request(app.getHttpServer()).get(url).expect(302);
    // A captured callback URL must not be worth anything a second time.
    await request(app.getHttpServer()).get(url).expect(400);
  });

  it('logs the same provider account back into the same user', async () => {
    const signIn = async () => {
      const start = await request(app.getHttpServer())
        .get('/auth/oauth/google/start')
        .expect(302);
      const state = new URL(start.headers.location).searchParams.get('state');
      const code = FakeOAuthProviderAdapter.encode({
        providerAccountId: 'sub_stable', email: 'stable@flick.test',
        emailVerified: true, displayName: 'Stable', avatarUrl: null,
      });
      const res = await request(app.getHttpServer())
        .get(`/auth/oauth/google/callback?code=${code}&state=${state}`)
        .expect(302);
      return res.headers['set-cookie'] as unknown as string[];
    };

    const first = await signIn();
    const second = await signIn();

    const idOf = async (cookie: string[]) => {
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      return (me.body as { id: string }).id;
    };

    // A second sign-in is a login, not a second account.
    expect(await idOf(first)).toBe(await idOf(second));
  });
```

- [ ] **Step 8: Run everything**

```bash
cd apps/flick-api && npm test && npm run test:e2e && npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/flick-api/src/auth/oauth/ apps/flick-api/test/oauth.e2e-spec.ts \
        apps/flick-api/src/app.module.ts
git commit -m "feat(auth): add the OAuth start and callback endpoints

Social login mints the existing access_token cookie rather than inventing a
session, so JwtStrategy, the guards and the frontend's getSession are all
untouched. The redirect target is allowlisted before it is stored, using
the same rules as the frontend's safeNext -- a callback that will redirect
anywhere is an open redirect -- and the redirect carries a destination,
never the token. An unconfigured provider 404s instead of guessing."
```

---

## Task 9: The login screen

**Files:**
- Modify: `apps/flick-app/src/types/api.ts`
- Create: `apps/flick-app/src/features/auth/oauth.ts`
- Create: `apps/flick-app/src/features/auth/oauth.test.ts`
- Modify: `apps/flick-app/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `GET /auth/oauth/providers` (Task 8).
- Produces: `fetchOAuthProviders(): Promise<string[]>` and
  `oauthStartUrl(provider: string, next: string | null): string`.

**Context:** `apiFetch` is typed by the `ApiPath` union (`types/api.ts:22-40`),
with a matching `ApiResponse` conditional and a runtime decoder — a new endpoint
must be added to all three or it will not type-check. The start URL is a full
browser navigation, not a fetch: the browser must follow redirects to Google and
receive a cookie, which XHR cannot do.

- [ ] **Step 1: Register the endpoint in the contract**

In `apps/flick-app/src/types/api.ts` add `| '/auth/oauth/providers'` to the
`ApiPath` union, add to `ApiResponse`:

```typescript
  : Path extends '/auth/oauth/providers' ? { providers: string[] }
```

and add a decode branch inside `decodeApiResponse` that requires `providers` to
be an array of strings, matching how the neighbouring branches validate.

- [ ] **Step 2: Write the failing test**

Create `apps/flick-app/src/features/auth/oauth.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { oauthStartUrl } from './oauth';

describe('oauthStartUrl', () => {
  it('carries an in-app destination through the round trip', () => {
    expect(oauthStartUrl('google', '/movie/abc')).toContain(
      `next=${encodeURIComponent('/movie/abc')}`,
    );
  });

  it('drops an off-origin destination rather than forwarding it', () => {
    // safeNext already governs this on the client; the server allowlists again.
    expect(oauthStartUrl('google', 'https://evil.com')).not.toContain('evil.com');
  });

  it('omits next entirely when there is none', () => {
    expect(oauthStartUrl('google', null)).not.toContain('next=');
  });
});
```

- [ ] **Step 3: Run it to watch it fail**

```bash
cd apps/flick-app && npx vitest run src/features/auth/oauth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write it**

Create `apps/flick-app/src/features/auth/oauth.ts`:

```typescript
'use client';
import API_BASE_URL from '@/lib/api';
import { apiFetch } from '@/lib/apiClient';
import { safeNext } from '@/lib/nextParam';

/** Which providers the API actually has credentials for. */
export async function fetchOAuthProviders(): Promise<string[]> {
  try {
    const data = await apiFetch('/auth/oauth/providers');
    return data.providers;
  } catch {
    // A provider list we cannot load means no buttons, not a broken page:
    // OTP still works.
    return [];
  }
}

/**
 * A full browser navigation, never a fetch. The browser has to follow the
 * redirect to the provider and come back holding a Set-Cookie; XHR cannot.
 */
export function oauthStartUrl(provider: string, next: string | null): string {
  const safe = safeNext(next);
  const query = safe ? `?next=${encodeURIComponent(safe)}` : '';
  return `${API_BASE_URL}/auth/oauth/${provider}/start${query}`;
}
```

- [ ] **Step 5: Add the button and the conflict message**

In `apps/flick-app/src/app/login/page.tsx`, inside `LoginForm`, load the
providers on mount and render a button per provider below the phone form:

```tsx
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    void fetchOAuthProviders().then(setProviders);
  }, []);
```

```tsx
  {providers.includes('google') && (
    <a
      href={oauthStartUrl('google', searchParams.get('next'))}
      className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-medium text-fg"
    >
      เข้าสู่ระบบด้วย Google
    </a>
  )}
```

An `<a>`, not a `<button>` with `router.push`: this must be a document
navigation.

The callback redirects to `/login?error=email_claimed` when the API returns 409
(spec §6.3). Render that case above the form, using this exact string:

```tsx
  {searchParams.get('error') === 'email_claimed' && (
    <p role="alert" className="rounded-xl bg-ink-1 p-3 text-sm text-fg-mute">
      มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์
    </p>
  )}
```

Do not translate or reword it — it is specified verbatim in spec §6.3, and it
says "an account", never "your account", on purpose.

Task 8 already redirects to `/login?error=email_claimed` on `ConflictException`,
so nothing in the API changes here. This task is frontend-only.

- [ ] **Step 6: Run the tests**

```bash
cd apps/flick-app && npm test && npm run lint && npm run build
```

Expected: PASS, 92 tests (89 + 3).

- [ ] **Step 7: Commit**

```bash
git add apps/flick-app/src/types/api.ts \
        apps/flick-app/src/features/auth/oauth.ts \
        apps/flick-app/src/features/auth/oauth.test.ts \
        apps/flick-app/src/app/login/page.tsx
git commit -m "feat(app): offer Google sign-in on the login screen

The button renders only when the API reports Google configured, so a
half-configured deploy shows no dead end. It is an anchor, not a router
push: the browser has to follow the redirect to Google and come back
holding a Set-Cookie, which XHR cannot do. The next destination survives
the round trip through safeNext on the way out and the server's allowlist
on the way back.

The refuse-to-auto-link case now redirects to the login screen with a
message telling the user to sign in their usual way and link from their
profile, rather than returning a bare 409."
```

---

## Task 10: The scheduled reaper

**Files:**
- Create: `apps/flick-api/src/maintenance/prune.service.ts`
- Create: `apps/flick-api/src/maintenance/prune.service.spec.ts`
- Create: `apps/flick-api/src/maintenance/maintenance.module.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Modify: `apps/flick-api/package.json`

**Interfaces:**
- Consumes: `prisma.oAuthState`, `prisma.otpChallenge`.
- Produces: `PruneService.pruneExpired(): Promise<{ oauthStates: number; otpChallenges: number }>`,
  callable directly so the test does not wait on a cron.

**Context:** Spec §9 and decisions 6-8. `OtpChallenge` is included because it has
the same unbounded growth and an `@@index([expiresAt])` (`schema.prisma:120`)
added for a reaper nobody wrote.

**The retention floor is the point of this task's hardest test.**
`enforceRateLimits` (`otp.service.ts:159-198`) derives all four OTP limits by
*counting* `OtpChallenge` rows over `OTP_LONG_WINDOW_MS` (24h). Deleting a row
inside that window silently weakens the abuse control with nothing in the logs.
7 days clears it by 7×, and the test asserts the *relationship*, not the literal,
so a future trim cannot cross the floor unnoticed.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/flick-api && npm install @nestjs/schedule
```

- [ ] **Step 2: Write the failing tests**

Create `apps/flick-api/src/maintenance/prune.service.spec.ts`:

```typescript
import {
  OTP_CHALLENGE_RETENTION_MS,
  OAUTH_STATE_RETENTION_MS,
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
    prisma.oAuthState.deleteMany.mockResolvedValue({ count: 3 });
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

    const otpCall = prisma.otpChallenge.deleteMany.mock.calls[0][0] as {
      where: { expiresAt: { lt: Date } };
    };
    const cutoff = otpCall.where.expiresAt.lt.getTime();
    expect(cutoff).toBeLessThanOrEqual(before - OTP_CHALLENGE_RETENTION_MS + 1000);
    expect(cutoff).toBeGreaterThan(before - OTP_CHALLENGE_RETENTION_MS - 5000);
  });

  it('reports what it removed', async () => {
    await expect(service.pruneExpired()).resolves.toEqual({
      oauthStates: 3,
      otpChallenges: 7,
    });
  });

  it('prunes oauth states on their own, shorter retention', async () => {
    await service.pruneExpired();

    expect(OAUTH_STATE_RETENTION_MS).toBeLessThan(OTP_CHALLENGE_RETENTION_MS);
    expect(prisma.oAuthState.deleteMany).toHaveBeenCalled();
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

/** Nothing reads an OAuth state a day after it expired. */
export const OAUTH_STATE_RETENTION_MS = 24 * 60 * 60 * 1000;

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
    if (removed.oauthStates > 0 || removed.otpChallenges > 0) {
      this.logger.log(
        `Pruned ${removed.oauthStates} oauth states, ${removed.otpChallenges} otp challenges`,
      );
    }
  }

  async pruneExpired(): Promise<{ oauthStates: number; otpChallenges: number }> {
    const now = Date.now();

    const [oauthStates, otpChallenges] = await Promise.all([
      this.prisma.oAuthState.deleteMany({
        where: { expiresAt: { lt: new Date(now - OAUTH_STATE_RETENTION_MS) } },
      }),
      this.prisma.otpChallenge.deleteMany({
        where: { expiresAt: { lt: new Date(now - OTP_CHALLENGE_RETENTION_MS) } },
      }),
    ]);

    return {
      oauthStates: oauthStates.count,
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
git commit -m "feat(api): prune expired oauth states and otp challenges

Both tables grow without bound; OtpChallenge has had an @@index([expiresAt])
waiting for a reaper nobody wrote. OAuth states die a day after expiry, OTP
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

## Task 11: Whole-pass verification

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

Expected: all green. Record the two test counts.

- [ ] **Step 2: Security audit**

Confirm each by reading the code, not by assuming:

```bash
cd apps/flick-api
# No blanket P2002 catch was introduced.
grep -rn "P2002" src/auth/oauth/          # every hit must inspect meta.target
# No secret can reach a log.
grep -rn "logger\." src/auth/oauth/       # no code, state, verifier or token
# The unverified-email rule has a test.
npx jest identity-resolver.spec -t "NEVER links"
```

- [ ] **Step 3: Manual round trip**

With real Google credentials in `.env`, confirm end to end: a first sign-in
creates a user and lands on `/home`; a second sign-in returns the *same* user
id from `/auth/me`; `?next=/movie/<id>` returns there; a tampered `state`
gives a 400.

- [ ] **Step 4: Commit the verification record**

```bash
git commit --allow-empty -m "docs: record verification of the Google social login pass

flick-api <N> tests + e2e + lint green; flick-app <M> tests + lint + build
green; performance:check exit 0. Audited: no blanket P2002 catch, no secret
in a log line, unverified-email rule covered by test. Manual round trip
confirmed against real Google credentials."
```

Replace `<N>` and `<M>` with the real counts. A record with placeholders is not
a record.

---

## Sequencing

| Task | Depends on | Why here |
|---|---|---|
| 1 — schema | — | Everything reads these models. |
| 2 — port + fake | — | The fake adapter unblocks 4-8 before a credential exists. |
| 3 — state | 1 | Needed by the controller; independent of the resolver. |
| 4 — resolver | 1, 2 | The security core. Deserves its own review gate. |
| 5 — concurrency | 4 | Same file; separated so a reviewer can judge the race handling on its own. |
| 6 — Google adapter | 2 | Only real-network task. Independent of 3-5. |
| 7 — wiring | 2, 6 | Needs both adapters to exist to register them. |
| 8 — HTTP | 3, 5, 7 | The first task that produces a working login. |
| 9 — frontend | 8 | Needs the endpoints. |
| 10 — reaper | 1 | Independent of everything after Task 1; could run any time. |
| 11 — verification | all | Runs the gate CI runs. |

---

## Not in this plan

- **Apple.** Its own plan, against a resolver this one proves. Spec §8 records
  what it will need: ES256 client-secret minting, the cross-site `form_post`
  callback, `email_verified` as a string, relay addresses, first-authorization
  names.
- **Linking from an authenticated profile.** Spec §11.1. The schema supports it;
  the endpoint and UI are a later phase. It is also the answer for a user who
  ends up with two accounts.
- **Unlinking**, which needs the rule "never remove the last credential".
- **Merging two existing accounts.**
