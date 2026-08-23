# OTP Authentication + Secure Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/password login with phone-first passwordless OTP, and turn the deliberately-disabled `POST /subscriptions` into a real, idempotent, gateway-agnostic payment flow.

**Architecture:** Two subsystems behind ports. OTP lives in `apps/flick-api/src/auth/otp/` with an `OtpDeliveryPort` (Console adapter for dev/CI, SMS/Email adapters for production). Payments live in `apps/flick-api/src/payments/` with a `PaymentGatewayPort` (FakeGateway for tests, Omise for production). Entitlement is granted **only** inside a single Prisma `$transaction` driven by a signature-verified webhook — never by a browser redirect.

**Tech Stack:** NestJS 11 · Prisma 7.9 (`prisma-client-js` generator + `@prisma/adapter-pg` driver adapter) · PostgreSQL · bcrypt · Jest 30 (`*.spec.ts`, `rootDir: src`) · Next.js 16.2.12 / React 19.2.4 / Vitest (frontend)

**Spec:** `docs/superpowers/specs/2026-08-23-otp-auth-payments-design.md`

---

## Global Constraints

These apply to **every** task. Each task's requirements implicitly include this section.

**Security invariants (non-negotiable — the whole point of this work):**
- Prices are resolved **server-side** from `apps/flick-api/src/plans/plans.config.ts`. No request body may carry a price or amount field. There is nothing to validate because there is nothing to trust.
- Entitlement (subscription or coins) is granted **only** by a signature-verified webhook, never by a browser return-URL.
- `PaymentEvent.gatewayEventId @unique` is the **entire** idempotency mechanism. Never add a read-then-write "have I seen this?" check — that race is exactly what the unique constraint exists to close.
- The webhook signature is verified over the **raw, unparsed** request bytes. If the JSON parser touches the body first, the HMAC is computed over re-serialized bytes and every real webhook fails.
- `PaymentEvent` + `PaymentIntent` + entitlement all commit in **one** `$transaction`, or none do.
- OTP codes come from `crypto.randomInt` — **never** `Math.random`.
- OTP codes are bcrypt-hashed at rest. Plaintext codes never touch the DB, logs, or a response body.
- OTP consumption is single-use via `updateMany` guarded on `consumedAt: null`. Checking-then-updating is a race.
- Never log a full phone number, email, or OTP code. Use `maskDestination()` (Task 2).

**Must survive unchanged:**
- `WalletService.spend()` / `unlockEpisode()` and their `SELECT ... FOR UPDATE` row-lock pattern (`apps/flick-api/src/wallet/wallet.service.ts:41-49`).
- `SubscriptionsService` entitlement logic — ACTIVE **or** CANCELED-until-`endDate` (`apps/flick-api/src/subscriptions/subscriptions.service.ts:5-8`).
- `plans.config.ts` as the sole price source.

**Money units:** `plans.config.ts` `price` fields are in **baht** (49, 149, 35, 99, 299). The database stores **satangs**. Always multiply by 100. Never store a float.

**Copy:** User-facing error messages are Thai-first, matching the existing codebase style (e.g. `'เหรียญไม่เพียงพอ (Insufficient coins)'`). Error messages must be **generic** on the OTP paths — never reveal whether an account exists.

**Frontend (`apps/flick-app`) — read this before writing any frontend code:** `apps/flick-app/AGENTS.md` states this is **not** the Next.js you know. Breaking changes exist. Read the relevant guide in `apps/flick-app/node_modules/next/dist/docs/` before writing frontend code. Heed deprecation notices.

**Frontend API contract:** `apps/flick-app/src/types/api.ts` holds a typed `ApiPath` union, an `ApiResponse<Path>` conditional type, and a runtime `decodeApiResponse()` validator. **Every** new endpoint must be added to all three, or `apiFetch` throws a 502 "ไม่ตรงตามสัญญา API" at runtime.

**Commands:**
- API tests: `cd apps/flick-api && npm test` (or `npm test -- <pattern>`)
- API e2e: `cd apps/flick-api && npm run test:e2e`
- API lint: `cd apps/flick-api && npm run lint`
- Frontend tests: `cd apps/flick-app && npm test`
- Migration: `cd apps/flick-api && npm run migrate:dev -- --name <name>`

**Commit style:** Match recent history — `feat(scope): ...`, `refactor(core): ...`, `docs: ...`.

---

## File Structure

**Phase 1–3 (OTP), new directory `apps/flick-api/src/auth/otp/`:**

| File | Responsibility |
|---|---|
| `destination.ts` | E.164 / email normalization + log masking. Pure functions, no deps. |
| `otp.config.ts` | Every OTP tunable in one place (TTL, attempt cap, rate-limit windows). |
| `otp-code.ts` | Code + ref generation, hashing, timing-safe compare. Pure crypto. |
| `otp-delivery.port.ts` | `OtpDeliveryPort` interface + DI token. |
| `adapters/console-delivery.adapter.ts` | Dev/CI adapter: logs the code, records it for e2e retrieval. |
| `adapters/sms-delivery.adapter.ts` | Production SMS (Phase 3). |
| `adapters/email-delivery.adapter.ts` | Production email (Phase 3). |
| `otp.service.ts` | Request/verify orchestration, rate limits, transaction. |
| `otp.module.ts` | Config-driven adapter selection. |

**Phase 4–6 (payments), new directory `apps/flick-api/src/payments/`:**

| File | Responsibility |
|---|---|
| `catalog.ts` | `itemType` + `itemId` → server-resolved amount/coins/duration. The only place baht→satangs happens. |
| `payment-gateway.port.ts` | `PaymentGatewayPort` interface, `GatewayEvent` shape, DI token. |
| `adapters/fake-gateway.adapter.ts` | Deterministic test gateway + HMAC webhook synthesis. |
| `adapters/omise-gateway.adapter.ts` | Production gateway (Phase 6). |
| `dto/create-checkout.dto.ts` | Checkout request DTO — carries **no** amount field. |
| `payments.service.ts` | Intent creation + transactional webhook fulfillment. |
| `payments.controller.ts` | `POST /payments/checkout`, `POST /payments/webhook/:gateway`. |
| `payments.module.ts` | Config-driven gateway selection. |

---

## Phase 1 — OTP Engine

No user-facing change. Everything in this phase is covered by unit tests.

---

### Task 1: Schema — `OtpChallenge`, enums, nullable `passwordHash`

**Files:**
- Modify: `apps/flick-api/prisma/schema.prisma:31-42` (enums), `:48-80` (User model)
- Create: `apps/flick-api/prisma/migrations/<timestamp>_otp_challenges/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: Prisma model `OtpChallenge`, enums `OtpChannel { SMS | EMAIL }` and `OtpPurpose { LOGIN | VERIFY_EMAIL }`, and `User.passwordHash: String?`. All later tasks depend on `prisma generate` having run against this.

**Context:** `User.phone` is **already** `String? @unique` (`schema.prisma:51`) — no change needed there. Only `passwordHash` must become nullable, because passwordless users never have one.

- [x] **Step 1: Add the two enums**

In `apps/flick-api/prisma/schema.prisma`, after the `InteractionType` enum (line 42), add:

```prisma
enum OtpChannel {
  SMS
  EMAIL
}

enum OtpPurpose {
  LOGIN // covers both login and lazy-register — a passwordless user is created on first successful verify
  VERIFY_EMAIL
}
```

- [x] **Step 2: Make `passwordHash` nullable**

In the `User` model, change line 52 from:

```prisma
  passwordHash String
```

to:

```prisma
  passwordHash String? // null for passwordless (OTP) users — the default after Phase 2
```

- [x] **Step 3: Add the `OtpChallenge` model**

Add after the `Device` model (after line 101):

```prisma
model OtpChallenge {
  id          String     @id @default(uuid())
  channel     OtpChannel
  destination String // normalized: E.164 (+66...) for SMS, lowercased for EMAIL
  codeHash    String // bcrypt hash of the 6-digit code — the plaintext is never persisted
  ref         String // 4-char display hint, shown to the client and included in the message
  purpose     OtpPurpose
  attempts    Int        @default(0)
  userId      String? // set once the associated User is known or created
  ipAddress   String
  expiresAt   DateTime
  consumedAt  DateTime? // non-null means burned: verified, superseded, or attempt-capped
  createdAt   DateTime   @default(now())

  // Serves the verify lookup (destination + purpose + unconsumed) and every
  // rate-limit count, which all filter on destination + createdAt.
  @@index([destination, purpose, consumedAt])
  @@index([destination, createdAt])
  @@index([expiresAt])
  @@map("otp_challenges")
}
```

- [x] **Step 4: Generate the migration and client**

Run: `cd apps/flick-api && npm run migrate:dev -- --name otp_challenges`
Expected: a new folder under `prisma/migrations/`, and the Prisma client regenerated.

If no database is reachable, run `npx prisma migrate dev --create-only --name otp_challenges` and then `npx prisma generate`.

- [x] **Step 5: Verify the client picked up the new types**

Run: `cd apps/flick-api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. (`OtpChannel`, `OtpPurpose` are now importable from `@prisma/client`.)

Note: `apps/flick-api/src/auth/auth.service.ts:56` calls `bcrypt.compare(loginDto.password, user.passwordHash)`, which is now `string | null` and will fail type-check. Fix it in place for now with a null guard — Task 12 deletes this method entirely:

```ts
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'อีเมลหรือรหัสผ่านไม่ถูกต้อง (Invalid credentials)',
      );
    }
    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
```

- [x] **Step 6: Re-run type-check and the suite**

Run: `cd apps/flick-api && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/flick-api/prisma/schema.prisma apps/flick-api/prisma/migrations apps/flick-api/src/auth/auth.service.ts
git commit -m "feat(auth): add OtpChallenge model and make passwordHash nullable"
```

---

### Task 2: Destination normalization

**Files:**
- Create: `apps/flick-api/src/auth/otp/destination.ts`
- Test: `apps/flick-api/src/auth/otp/destination.spec.ts`

**Interfaces:**
- Consumes: `OtpChannel` from `@prisma/client` (Task 1)
- Produces:
  - `normalizeDestination(raw: string, channel: OtpChannel): string` — throws `BadRequestException` on invalid input
  - `maskDestination(destination: string): string` — for logs

**Why this exists:** `0812345678` and `+66812345678` are the same human. Without normalization *before* every DB lookup, they become two accounts, and the rate limiter counts them separately.

- [ ] **Step 1: Write the failing test**

Create `apps/flick-api/src/auth/otp/destination.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';
import { maskDestination, normalizeDestination } from './destination';

describe('normalizeDestination', () => {
  const sms = (raw: string) => normalizeDestination(raw, OtpChannel.SMS);

  it('maps every Thai spelling of one number to the same E.164 string', () => {
    // This equivalence IS the feature: these must not become separate accounts.
    const expected = '+66812345678';
    expect(sms('0812345678')).toBe(expected);
    expect(sms('081-234-5678')).toBe(expected);
    expect(sms(' 081 234 5678 ')).toBe(expected);
    expect(sms('+66812345678')).toBe(expected);
    expect(sms('+66 81 234 5678')).toBe(expected);
    expect(sms('66812345678')).toBe(expected);
  });

  it('rejects numbers that are not plausible E.164', () => {
    expect(() => sms('123')).toThrow(BadRequestException);
    expect(() => sms('08123456789012345')).toThrow(BadRequestException);
    expect(() => sms('not-a-phone')).toThrow(BadRequestException);
    expect(() => sms('')).toThrow(BadRequestException);
  });

  it('lowercases and trims email destinations', () => {
    expect(normalizeDestination('  User@Example.COM ', OtpChannel.EMAIL)).toBe(
      'user@example.com',
    );
  });

  it('rejects malformed email destinations', () => {
    expect(() => normalizeDestination('nope', OtpChannel.EMAIL)).toThrow(
      BadRequestException,
    );
  });
});

describe('maskDestination', () => {
  it('never returns the full phone number', () => {
    const masked = maskDestination('+66812345678');
    expect(masked).not.toBe('+66812345678');
    expect(masked).not.toContain('2345');
  });

  it('never returns the full email local part', () => {
    const masked = maskDestination('someone@example.com');
    expect(masked).not.toContain('someone');
    expect(masked).toContain('example.com');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- destination`
Expected: FAIL — `Cannot find module './destination'`.

- [ ] **Step 3: Write the implementation**

Create `apps/flick-api/src/auth/otp/destination.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';

const INVALID_PHONE = 'เบอร์โทรศัพท์ไม่ถูกต้อง (Invalid phone number)';
const INVALID_EMAIL = 'อีเมลไม่ถูกต้อง (Invalid email)';

/** Deliberately loose — real validation is "can we deliver to it", not a regex. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

/**
 * Collapses every way a Thai user might type their number into one canonical
 * E.164 string. This runs BEFORE any database lookup — `0812345678` and
 * `+66812345678` must resolve to the same `User` row, and must share one
 * rate-limit bucket.
 */
function normalizeThaiPhone(raw: string): string {
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  let e164: string;
  if (hadPlus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('66') && digits.length === 11) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('0') && digits.length === 10) {
    // Thai national format: drop the trunk '0', prepend the country code.
    e164 = `+66${digits.slice(1)}`;
  } else {
    throw new BadRequestException(INVALID_PHONE);
  }

  if (!E164_SHAPE.test(e164)) throw new BadRequestException(INVALID_PHONE);
  return e164;
}

export function normalizeDestination(raw: string, channel: OtpChannel): string {
  if (channel === OtpChannel.EMAIL) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(email)) throw new BadRequestException(INVALID_EMAIL);
    return email;
  }
  return normalizeThaiPhone(raw);
}

/**
 * Log-safe rendering. A destination is PII and an OTP-delivery target; full
 * values must never reach a log aggregator.
 */
export function maskDestination(destination: string): string {
  if (destination.includes('@')) {
    const [local, domain] = destination.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return `${destination.slice(0, 5)}****${destination.slice(-2)}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/flick-api && npm test -- destination`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/src/auth/otp/destination.ts apps/flick-api/src/auth/otp/destination.spec.ts
git commit -m "feat(auth): normalize OTP destinations to E.164 and lowercased email"
```

---

### Task 3: OTP config constants

**Files:**
- Create: `apps/flick-api/src/auth/otp/otp.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `OTP_TTL_MS`, `OTP_MAX_ATTEMPTS`, `OTP_BCRYPT_ROUNDS`, `OTP_COOLDOWN_MS`, `OTP_SHORT_WINDOW_MS`, `OTP_SHORT_WINDOW_MAX`, `OTP_LONG_WINDOW_MS`, `OTP_LONG_WINDOW_MAX`, `DEFAULT_OTP_GLOBAL_DAILY_CAP`, `OTP_REF_ALPHABET`, `OTP_REF_LENGTH`

There is no test for this file — it is data. It is a separate file so the tuning knobs are in one greppable place rather than scattered as literals through the service.

- [ ] **Step 1: Write the file**

Create `apps/flick-api/src/auth/otp/otp.config.ts`:

```ts
/** Every OTP tunable, in one place. See the spec's "Why each control exists". */

export const OTP_TTL_MS = 5 * 60 * 1000;

/** Wrong guesses allowed before the challenge is burned outright. */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Lower than the password cost (12) on purpose. The code space is only 10^6
 * and the TTL is 5 minutes, so offline-brute-force resistance is bounded by
 * expiry, not by hash cost — and this hash is computed inside the verify
 * transaction, where latency holds a database connection open.
 */
export const OTP_BCRYPT_ROUNDS = 10;

// --- Per-destination rate limits (financial-DoS and SMS-bombing controls) ---
export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_SHORT_WINDOW_MS = 15 * 60 * 1000;
export const OTP_SHORT_WINDOW_MAX = 3;
export const OTP_LONG_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OTP_LONG_WINDOW_MAX = 10;

/**
 * Service-wide 24h send ceiling. Every SMS costs money, so an attacker
 * spraying thousands of distinct destinations is a billing attack that
 * per-destination limits cannot see. Override with OTP_GLOBAL_DAILY_CAP.
 */
export const DEFAULT_OTP_GLOBAL_DAILY_CAP = 5000;

/** Unambiguous characters only — no I/O/0/1, which users mistype off a screen. */
export const OTP_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const OTP_REF_LENGTH = 4;
```

- [ ] **Step 2: Commit**

```bash
git add apps/flick-api/src/auth/otp/otp.config.ts
git commit -m "feat(auth): add OTP tuning constants"
```

---

### Task 4: Code generation, hashing, timing-safe compare

**Files:**
- Create: `apps/flick-api/src/auth/otp/otp-code.ts`
- Test: `apps/flick-api/src/auth/otp/otp-code.spec.ts`

**Interfaces:**
- Consumes: `OTP_BCRYPT_ROUNDS`, `OTP_REF_ALPHABET`, `OTP_REF_LENGTH` from `./otp.config` (Task 3)
- Produces:
  - `generateOtpCode(): string` — 6 digits, zero-padded
  - `generateOtpRef(): string` — 4 chars from `OTP_REF_ALPHABET`
  - `hashOtpCode(code: string): Promise<string>`
  - `compareOtpCode(code: string, hash: string): Promise<boolean>`
  - `timingSafeEqualString(a: string, b: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/flick-api/src/auth/otp/otp-code.spec.ts`:

```ts
import {
  compareOtpCode,
  generateOtpCode,
  generateOtpRef,
  hashOtpCode,
  timingSafeEqualString,
} from './otp-code';
import { OTP_REF_ALPHABET, OTP_REF_LENGTH } from './otp.config';

describe('generateOtpCode', () => {
  it('always produces exactly 6 digits, including low values', () => {
    // Zero-padding matters: randomInt can return 42, and "42" is not a
    // 6-digit code the user can type back.
    for (let i = 0; i < 500; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('does not collapse to a small set of values', () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateOtpCode()));
    expect(seen.size).toBeGreaterThan(200);
  });
});

describe('generateOtpRef', () => {
  it('uses only unambiguous alphabet characters', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateOtpRef();
      expect(ref).toHaveLength(OTP_REF_LENGTH);
      for (const ch of ref) expect(OTP_REF_ALPHABET).toContain(ch);
    }
  });
});

describe('hashOtpCode / compareOtpCode', () => {
  it('never stores the plaintext code in the hash', async () => {
    const hash = await hashOtpCode('123456');
    expect(hash).not.toContain('123456');
  });

  it('accepts the right code and rejects a wrong one', async () => {
    const hash = await hashOtpCode('123456');
    await expect(compareOtpCode('123456', hash)).resolves.toBe(true);
    await expect(compareOtpCode('123457', hash)).resolves.toBe(false);
  });
});

describe('timingSafeEqualString', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(timingSafeEqualString('AB2C', 'AB2C')).toBe(true);
    expect(timingSafeEqualString('AB2C', 'AB2D')).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    // crypto.timingSafeEqual throws on unequal buffer lengths; an attacker
    // must not be able to turn that into a 500.
    expect(timingSafeEqualString('AB2C', 'AB')).toBe(false);
    expect(timingSafeEqualString('', 'AB2C')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- otp-code`
Expected: FAIL — `Cannot find module './otp-code'`.

- [ ] **Step 3: Write the implementation**

Create `apps/flick-api/src/auth/otp/otp-code.ts`:

```ts
import { randomInt, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  OTP_BCRYPT_ROUNDS,
  OTP_REF_ALPHABET,
  OTP_REF_LENGTH,
} from './otp.config';

/**
 * A 6-digit code from a CSPRNG. `Math.random` is a non-cryptographic PRNG
 * whose internal state is recoverable from a handful of outputs — with it, an
 * attacker who requests a few codes for their own number can predict the code
 * sent to someone else's. `randomInt` draws from the OS entropy pool.
 */
export function generateOtpCode(): string {
  // Upper bound is exclusive, so this yields 0..999999 uniformly. Padding is
  // what makes 42 into a typable "000042".
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * A short human-readable handle shown on screen and repeated in the message,
 * so a user with two codes in their inbox knows which screen each belongs to.
 * Collision-tolerant by design: it is a display hint, never a lookup key on
 * its own — verify always scopes by destination first.
 */
export function generateOtpRef(): string {
  let ref = '';
  for (let i = 0; i < OTP_REF_LENGTH; i++) {
    ref += OTP_REF_ALPHABET[randomInt(0, OTP_REF_ALPHABET.length)];
  }
  return ref;
}

export function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
}

export function compareOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/**
 * Constant-time string comparison that degrades to `false` instead of throwing
 * on a length mismatch (`crypto.timingSafeEqual` requires equal lengths).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/flick-api && npm test -- otp-code`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/src/auth/otp/otp-code.ts apps/flick-api/src/auth/otp/otp-code.spec.ts
git commit -m "feat(auth): generate OTP codes with crypto.randomInt and hash them at rest"
```

---

### Task 5: Delivery port + Console adapter

**Files:**
- Create: `apps/flick-api/src/auth/otp/otp-delivery.port.ts`
- Create: `apps/flick-api/src/auth/otp/adapters/console-delivery.adapter.ts`
- Test: `apps/flick-api/src/auth/otp/adapters/console-delivery.adapter.spec.ts`

**Interfaces:**
- Consumes: `maskDestination` from `../destination` (Task 2)
- Produces:
  - `OTP_DELIVERY_PORT` — DI token (`Symbol`)
  - `interface OtpDeliveryPort { send(destination: string, channel: OtpChannel, code: string, ref: string): Promise<void> }`
  - `class ConsoleOtpDeliveryAdapter implements OtpDeliveryPort` with `lastCodeFor(destination: string): string | undefined`

**Why `lastCodeFor` exists:** the e2e suite (Task 14) must complete a real OTP round-trip without an SMS vendor. The code is bcrypt-hashed in the DB, so it cannot be read back. This adapter is selected only when `OTP_DELIVERY=console`, which Task 17 forbids in production.

- [ ] **Step 1: Write the port**

Create `apps/flick-api/src/auth/otp/otp-delivery.port.ts`:

```ts
import type { OtpChannel } from '@prisma/client';

/** DI token — an interface has no runtime value to inject against. */
export const OTP_DELIVERY_PORT = Symbol('OTP_DELIVERY_PORT');

export interface OtpDeliveryPort {
  /**
   * Delivers `code` to `destination`. The `ref` is included in the message
   * body so the recipient can match the code to the screen that asked for it.
   * Implementations MUST NOT log or persist `code`.
   *
   * Throws on delivery failure; the caller converts that to a 503.
   */
  send(
    destination: string,
    channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/flick-api/src/auth/otp/adapters/console-delivery.adapter.spec.ts`:

```ts
import { OtpChannel } from '@prisma/client';
import { ConsoleOtpDeliveryAdapter } from './console-delivery.adapter';

describe('ConsoleOtpDeliveryAdapter', () => {
  let adapter: ConsoleOtpDeliveryAdapter;

  beforeEach(() => {
    adapter = new ConsoleOtpDeliveryAdapter();
  });

  it('makes the delivered code retrievable per destination', async () => {
    await adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C');
    await adapter.send('+66899999999', OtpChannel.SMS, '654321', 'XY9Z');

    expect(adapter.lastCodeFor('+66812345678')).toBe('123456');
    expect(adapter.lastCodeFor('+66899999999')).toBe('654321');
    expect(adapter.lastCodeFor('+66800000000')).toBeUndefined();
  });

  it('keeps only the most recent code for a destination', async () => {
    await adapter.send('+66812345678', OtpChannel.SMS, '111111', 'AAAA');
    await adapter.send('+66812345678', OtpChannel.SMS, '222222', 'BBBB');
    expect(adapter.lastCodeFor('+66812345678')).toBe('222222');
  });

  it('never writes the unmasked destination to the log', async () => {
    const logs: string[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((msg: unknown) => void logs.push(String(msg)));

    await adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C');

    expect(logs.join('\n')).not.toContain('+66812345678');
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- console-delivery`
Expected: FAIL — `Cannot find module './console-delivery.adapter'`.

- [ ] **Step 4: Write the implementation**

Create `apps/flick-api/src/auth/otp/adapters/console-delivery.adapter.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { OtpChannel } from '@prisma/client';
import { maskDestination } from '../destination';
import type { OtpDeliveryPort } from '../otp-delivery.port';

/**
 * Development and CI delivery. Prints the code to the server log and keeps the
 * most recent code per destination in memory so the e2e suite can complete a
 * real request→verify round-trip with no SMS vendor and no spend.
 *
 * Selected only when OTP_DELIVERY=console. `validateEnv` refuses that
 * combination when NODE_ENV=production, because this adapter delivers nothing
 * and would silently lock every user out.
 */
@Injectable()
export class ConsoleOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger('OtpDelivery');
  private readonly lastCodes = new Map<string, string>();

  send(
    destination: string,
    channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    this.lastCodes.set(destination, code);
    // The code appears here deliberately — that is this adapter's whole job in
    // local development. The destination is still masked, because dev logs get
    // pasted into issues.
    this.logger.log(
      `[${channel}] ${maskDestination(destination)} ref=${ref} code=${code}`,
    );
    return Promise.resolve();
  }

  /** Test/dev only. Returns the last code sent to `destination`, if any. */
  lastCodeFor(destination: string): string | undefined {
    return this.lastCodes.get(destination);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/flick-api && npm test -- console-delivery`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/src/auth/otp/otp-delivery.port.ts apps/flick-api/src/auth/otp/adapters/
git commit -m "feat(auth): add OTP delivery port and console adapter"
```

---

### Task 6: Extend the shared Prisma mock

**Files:**
- Modify: `apps/flick-api/src/testing/prisma.mock.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `createPrismaMock()` gains `otpChallenge`, `paymentIntent`, `paymentEvent`, and `user.findFirst` — every later service test depends on these being present.

**Context:** the existing mock (`src/testing/prisma.mock.ts:100`) passes the **same** instance into the `$transaction` callback, so stubbing `prisma.x` is equivalent to stubbing `tx.x`. Preserve that — the OTP verify and payment fulfillment tests both rely on it.

- [ ] **Step 1: Add the new model shapes to the interface**

In `apps/flick-api/src/testing/prisma.mock.ts`, extend the `PrismaMock` interface. Change the `user` line (line 9) to add `findFirst`, and add three new members before `$transaction`:

```ts
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
```

```ts
  otpChallenge: {
    findFirst: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  paymentIntent: {
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findUnique: jest.Mock;
  };
  paymentEvent: {
    create: jest.Mock;
  };
```

- [ ] **Step 2: Add the matching factory entries**

In `createPrismaMock()`, change the `user` entry (line 56) and add the three new ones alongside `subscription`:

```ts
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    otpChallenge: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    paymentIntent: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    paymentEvent: {
      create: jest.fn(),
    },
```

- [ ] **Step 3: Run the whole suite to confirm nothing regressed**

Run: `cd apps/flick-api && npm test`
Expected: PASS — the additions are purely additive.

- [ ] **Step 4: Commit**

```bash
git add apps/flick-api/src/testing/prisma.mock.ts
git commit -m "test: extend prisma mock with otpChallenge, paymentIntent, paymentEvent"
```

---

### Task 7: `OtpService.request()`

**Files:**
- Create: `apps/flick-api/src/auth/otp/otp.service.ts`
- Test: `apps/flick-api/src/auth/otp/otp.service.spec.ts`

**Interfaces:**
- Consumes: `normalizeDestination`/`maskDestination` (Task 2), all of `otp.config` (Task 3), `generateOtpCode`/`generateOtpRef`/`hashOtpCode` (Task 4), `OTP_DELIVERY_PORT`/`OtpDeliveryPort` (Task 5), `PrismaService`, `ConfigService`
- Produces:
  - `interface OtpRequestResult { ref: string; expiresIn: number }`
  - `class OtpService` with `request(input: { destination: string; channel: OtpChannel; ipAddress: string }): Promise<OtpRequestResult>`

**Three things this method must get right:**
1. **Uniform response.** The return shape is `{ ref, expiresIn }` whether or not an account exists. Anything else turns this endpoint into an account-enumeration oracle.
2. **Email is not a free-text destination.** An OTP may only be emailed to an address already verified on an account. Otherwise anyone could request a login code for `victim@example.com` at their own address — an account-takeover primitive. When the address does not qualify, the challenge row is **still created** (so the attempt counts against the rate limit) but nothing is delivered.
3. **Rate limits are computed from `OtpChallenge` rows**, so they need no extra table and cannot drift from what was actually issued.

- [ ] **Step 1: Write the failing test**

Create `apps/flick-api/src/auth/otp/otp.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { OtpChannel } from '@prisma/client';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma.service';
import { OTP_DELIVERY_PORT } from './otp-delivery.port';
import { createPrismaMock } from '../../testing/prisma.mock';
import { OTP_SHORT_WINDOW_MAX, OTP_TTL_MS } from './otp.config';

describe('OtpService.request', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let delivery: { send: jest.Mock };

  const noRateLimitHits = () => prisma.otpChallenge.count.mockResolvedValue(0);

  beforeEach(async () => {
    prisma = createPrismaMock();
    delivery = { send: jest.fn().mockResolvedValue(undefined) };
    prisma.otpChallenge.create.mockResolvedValue({ id: 'c1' });
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OTP_DELIVERY_PORT, useValue: delivery },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  it('normalizes the destination before storing or delivering it', async () => {
    noRateLimitHits();
    await service.request({
      destination: '081-234-5678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    const created = prisma.otpChallenge.create.mock.calls[0][0] as {
      data: { destination: string };
    };
    expect(created.data.destination).toBe('+66812345678');
    expect(delivery.send.mock.calls[0][0]).toBe('+66812345678');
  });

  it('never persists the plaintext code', async () => {
    noRateLimitHits();
    await service.request({
      destination: '+66812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    const created = prisma.otpChallenge.create.mock.calls[0][0] as {
      data: { codeHash: string };
    };
    const deliveredCode = delivery.send.mock.calls[0][2] as string;
    expect(created.data.codeHash).not.toBe(deliveredCode);
    expect(created.data.codeHash).not.toContain(deliveredCode);
  });

  it('invalidates any earlier live challenge for the destination', async () => {
    // A code left sitting in an SMS thread must stop working the moment a new
    // one is issued.
    noRateLimitHits();
    await service.request({
      destination: '+66812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          destination: '+66812345678',
          consumedAt: null,
        }),
      }),
    );
  });

  it('returns the same shape for an unknown destination as a known one', async () => {
    noRateLimitHits();
    const result = await service.request({
      destination: '+66812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });

    expect(result).toEqual({
      ref: expect.stringMatching(/^[A-Z2-9]{4}$/) as unknown as string,
      expiresIn: OTP_TTL_MS / 1000,
    });
    expect(Object.keys(result).sort()).toEqual(['expiresIn', 'ref']);
  });

  it('rejects a second request inside the cooldown window', async () => {
    // First count() call is the 60s cooldown bucket.
    prisma.otpChallenge.count.mockResolvedValue(1);

    await expect(
      service.request({
        destination: '+66812345678',
        channel: OtpChannel.SMS,
        ipAddress: '1.2.3.4',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('rejects once the 15-minute destination cap is reached', async () => {
    prisma.otpChallenge.count
      .mockResolvedValueOnce(0) // cooldown
      .mockResolvedValueOnce(OTP_SHORT_WINDOW_MAX) // 15 min
      .mockResolvedValueOnce(0) // 24h
      .mockResolvedValueOnce(0); // global

    await expect(
      service.request({
        destination: '+66812345678',
        channel: OtpChannel.SMS,
        ipAddress: '1.2.3.4',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('does not email a code to an address not verified on an account', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await service.request({
      destination: 'victim@example.com',
      channel: OtpChannel.EMAIL,
      ipAddress: '1.2.3.4',
    });

    // Nothing delivered — but the response is indistinguishable from success,
    // and the row still exists so the attempt counts against the rate limit.
    expect(delivery.send).not.toHaveBeenCalled();
    expect(prisma.otpChallenge.create).toHaveBeenCalled();
    expect(result.expiresIn).toBe(OTP_TTL_MS / 1000);
  });

  it('emails a code when the address is verified on an account', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await service.request({
      destination: 'owner@example.com',
      channel: OtpChannel.EMAIL,
      ipAddress: '1.2.3.4',
    });

    expect(delivery.send).toHaveBeenCalled();
  });

  it('surfaces a delivery failure as 503 without leaking the code', async () => {
    noRateLimitHits();
    delivery.send.mockRejectedValue(new Error('sms vendor down'));

    await expect(
      service.request({
        destination: '+66812345678',
        channel: OtpChannel.SMS,
        ipAddress: '1.2.3.4',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- otp.service`
Expected: FAIL — `Cannot find module './otp.service'`.

- [ ] **Step 3: Write the implementation**

Create `apps/flick-api/src/auth/otp/otp.service.ts`:

```ts
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { maskDestination, normalizeDestination } from './destination';
import { generateOtpCode, generateOtpRef, hashOtpCode } from './otp-code';
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from './otp-delivery.port';
import {
  DEFAULT_OTP_GLOBAL_DAILY_CAP,
  OTP_COOLDOWN_MS,
  OTP_LONG_WINDOW_MAX,
  OTP_LONG_WINDOW_MS,
  OTP_SHORT_WINDOW_MAX,
  OTP_SHORT_WINDOW_MS,
  OTP_TTL_MS,
} from './otp.config';

export interface OtpRequestResult {
  ref: string;
  expiresIn: number;
}

export interface OtpRequestInput {
  destination: string;
  channel: OtpChannel;
  ipAddress: string;
}

/**
 * Deliberately identical for every rate-limit trip. Distinguishing "you are in
 * cooldown" from "this destination is capped" would tell an attacker whether
 * someone else has been requesting codes for that number.
 */
const RATE_LIMITED =
  'ขอรหัสบ่อยเกินไป กรุณารอสักครู่ (Too many requests, please wait)';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly globalDailyCap: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    config: ConfigService,
  ) {
    this.globalDailyCap =
      Number(config.get<string | number>('OTP_GLOBAL_DAILY_CAP')) ||
      DEFAULT_OTP_GLOBAL_DAILY_CAP;
  }

  async request({
    destination,
    channel,
    ipAddress,
  }: OtpRequestInput): Promise<OtpRequestResult> {
    const normalized = normalizeDestination(destination, channel);
    const now = new Date();

    // An email may only receive a login code if it is ALREADY verified on an
    // account. Allowing a free-text address would let anyone request a code
    // for someone else's account and have it delivered to themselves.
    // SMS needs no such check: the phone IS the identity, and delivery to a
    // number the requester does not control reveals nothing to them.
    const deliverable =
      channel === OtpChannel.SMS ||
      (await this.prisma.user.findFirst({
        where: { email: normalized, isVerified: true, deletedAt: null },
        select: { id: true },
      })) !== null;

    await this.enforceRateLimits(normalized, now);

    // Supersede any live code for this destination before issuing a new one.
    await this.prisma.otpChallenge.updateMany({
      where: {
        destination: normalized,
        purpose: OtpPurpose.LOGIN,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    const code = generateOtpCode();
    const ref = generateOtpRef();

    await this.prisma.otpChallenge.create({
      data: {
        channel,
        destination: normalized,
        codeHash: await hashOtpCode(code),
        ref,
        purpose: OtpPurpose.LOGIN,
        ipAddress,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });

    if (deliverable) {
      try {
        await this.delivery.send(normalized, channel, code, ref);
      } catch (err) {
        // The challenge row survives, but no code was ever delivered, so it is
        // unusable. The cooldown still applies, which is what we want.
        this.logger.error(
          `OTP delivery failed for ${maskDestination(normalized)}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
        throw new ServiceUnavailableException(
          'ไม่สามารถส่งรหัสยืนยันได้ กรุณาลองใหม่ภายหลัง (Could not send code)',
        );
      }
    }

    // Identical shape on every path — this is what makes account enumeration
    // through this endpoint impossible.
    return { ref, expiresIn: Math.floor(OTP_TTL_MS / 1000) };
  }

  /**
   * All four limits are derived from OtpChallenge rows, so they can never
   * disagree with what was actually issued. Counting is cheap: every query
   * here is served by @@index([destination, createdAt]).
   */
  private async enforceRateLimits(
    destination: string,
    now: Date,
  ): Promise<void> {
    const since = (ms: number) => new Date(now.getTime() - ms);

    const [inCooldown, inShortWindow, inLongWindow, globalToday] =
      await Promise.all([
        this.prisma.otpChallenge.count({
          where: { destination, createdAt: { gt: since(OTP_COOLDOWN_MS) } },
        }),
        this.prisma.otpChallenge.count({
          where: { destination, createdAt: { gt: since(OTP_SHORT_WINDOW_MS) } },
        }),
        this.prisma.otpChallenge.count({
          where: { destination, createdAt: { gt: since(OTP_LONG_WINDOW_MS) } },
        }),
        this.prisma.otpChallenge.count({
          where: { createdAt: { gt: since(OTP_LONG_WINDOW_MS) } },
        }),
      ]);

    if (globalToday >= this.globalDailyCap) {
      // Per-destination limits cannot see an attacker spraying thousands of
      // distinct numbers. Every send costs money, so this is a billing attack
      // and deserves an alert, not just a 429.
      this.logger.error(
        `OTP global daily cap reached (${globalToday}/${this.globalDailyCap}) — possible SMS-pumping attack`,
      );
      throw new HttpException(RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (
      inCooldown > 0 ||
      inShortWindow >= OTP_SHORT_WINDOW_MAX ||
      inLongWindow >= OTP_LONG_WINDOW_MAX
    ) {
      throw new HttpException(RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/flick-api && npm test -- otp.service`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/src/auth/otp/otp.service.ts apps/flick-api/src/auth/otp/otp.service.spec.ts
git commit -m "feat(auth): implement rate-limited, enumeration-safe OTP request"
```

---

### Task 8: `OtpService.verify()`

**Files:**
- Modify: `apps/flick-api/src/auth/otp/otp.service.ts`
- Test: `apps/flick-api/src/auth/otp/otp.service.spec.ts` (add a second `describe`)

**Interfaces:**
- Consumes: everything from Task 7, plus `compareOtpCode`/`timingSafeEqualString` (Task 4) and `OTP_MAX_ATTEMPTS` (Task 3)
- Produces:
  - `interface OtpVerifyResult { userId: string; isNewUser: boolean }`
  - `OtpService.verify(input: { destination: string; channel: OtpChannel; ref: string; code: string }): Promise<OtpVerifyResult>`

**The three races this closes, and how:**
1. **Two concurrent correct submissions.** Consumption is `updateMany({ where: { id, consumedAt: null }, ... })`. Once the first commits, the second matches zero rows — `count === 0` means "already consumed", which is a 401, not a crash.
2. **Two concurrent wrong guesses inflating past the cap.** The attempts write is guarded on `attempts: challenge.attempts` (optimistic concurrency). A losing writer matches zero rows and is treated as a failed attempt, so the cap can never be walked past by racing.
3. **Timing leak between "bad ref" and "bad code".** Both comparisons run **before** either is branched on, so a wrong ref costs the same wall-clock time as a wrong code.

- [ ] **Step 1: Write the failing test**

Append to `apps/flick-api/src/auth/otp/otp.service.spec.ts`:

```ts
describe('OtpService.verify', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof createPrismaMock>;

  // A live challenge whose code is '123456'. Hashed at cost 4 to keep the
  // suite fast — production uses OTP_BCRYPT_ROUNDS.
  const liveChallenge = async (overrides = {}) => ({
    id: 'c1',
    channel: OtpChannel.SMS,
    destination: '+66812345678',
    codeHash: await bcrypt.hash('123456', 4),
    ref: 'AB2C',
    purpose: 'LOGIN',
    attempts: 0,
    userId: null,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OTP_DELIVERY_PORT, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  const verify = (code = '123456', ref = 'AB2C') =>
    service.verify({
      destination: '0812345678',
      channel: OtpChannel.SMS,
      ref,
      code,
    });

  it('logs in an existing user and reports isNewUser false', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await expect(verify()).resolves.toEqual({
      userId: 'u1',
      isNewUser: false,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('lazily creates a passwordless user on first verify', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u-new' });

    await expect(verify()).resolves.toEqual({
      userId: 'u-new',
      isNewUser: true,
    });

    const created = prisma.user.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.phone).toBe('+66812345678');
    expect(created.data.isVerified).toBe(true);
    expect(created.data.passwordHash).toBeUndefined();
  });

  it('consumes the challenge with a guard on consumedAt: null', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await verify();

    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', consumedAt: null },
        data: expect.objectContaining({
          consumedAt: expect.any(Date) as unknown as Date,
        }),
      }),
    );
  });

  it('rejects a replay whose consuming update matches zero rows', async () => {
    // Exactly what a concurrent second correct submission sees.
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired challenge generically', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(null);
    await expect(verify()).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a wrong ref even when the code is right', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    await expect(verify('123456', 'ZZZZ')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('increments attempts on a wrong code without consuming the challenge', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());

    await expect(verify('000000')).rejects.toThrow(UnauthorizedException);

    const call = prisma.otpChallenge.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.data.attempts).toBe(1);
    expect(call.data.consumedAt).toBeUndefined();
    // Optimistic guard — a racing writer must not be able to walk past the cap.
    expect(call.where.attempts).toBe(0);
  });

  it('burns the challenge and returns 429 on the final wrong attempt', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(
      await liveChallenge({ attempts: OTP_MAX_ATTEMPTS - 1 }),
    );

    await expect(verify('000000')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    const call = prisma.otpChallenge.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(call.data.consumedAt).toEqual(expect.any(Date));
  });

  it('refuses a burned challenge even with the correct code', async () => {
    // The challenge is consumed, so findFirst (which filters consumedAt: null)
    // returns nothing — the right code is now worthless.
    prisma.otpChallenge.findFirst.mockResolvedValue(null);
    await expect(verify('123456')).rejects.toThrow(UnauthorizedException);
  });
});
```

Add these imports at the top of the file:

```ts
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { OTP_MAX_ATTEMPTS } from './otp.config';
```

(and extend the existing `@nestjs/common` import to include `UnauthorizedException` rather than duplicating it).

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- otp.service`
Expected: FAIL — `service.verify is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `apps/flick-api/src/auth/otp/otp.service.ts`. First extend the imports:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { compareOtpCode, timingSafeEqualString } from './otp-code';
import { OTP_MAX_ATTEMPTS } from './otp.config';
```

Then add the result types near `OtpRequestResult`:

```ts
export interface OtpVerifyResult {
  userId: string;
  isNewUser: boolean;
}

export interface OtpVerifyInput {
  destination: string;
  channel: OtpChannel;
  ref: string;
  code: string;
}
```

Add the shared message constant beside `RATE_LIMITED`:

```ts
/** One message for every failure mode: unknown, expired, wrong ref, wrong code,
 *  already consumed. Anything more specific is an oracle. */
const INVALID_CODE = 'รหัสไม่ถูกต้องหรือหมดอายุ (Invalid or expired code)';
const ATTEMPTS_EXHAUSTED =
  'ใส่รหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่ (Too many attempts, request a new code)';
```

Then add the method to the class:

```ts
  /**
   * Verifies a code and resolves the caller to a user, creating one on first
   * success (lazy registration). Runs in one transaction so consumption and
   * user creation cannot come apart.
   */
  async verify({
    destination,
    channel,
    ref,
    code,
  }: OtpVerifyInput): Promise<OtpVerifyResult> {
    const normalized = normalizeDestination(destination, channel);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: {
          destination: normalized,
          purpose: OtpPurpose.LOGIN,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) throw new UnauthorizedException(INVALID_CODE);

      // Both comparisons run before either is branched on, so "wrong ref" and
      // "wrong code" cost the same time and are indistinguishable to a caller.
      const refMatches = timingSafeEqualString(challenge.ref, ref);
      const codeMatches = await compareOtpCode(code, challenge.codeHash);

      if (!refMatches || !codeMatches) {
        const attempts = challenge.attempts + 1;
        const exhausted = attempts >= OTP_MAX_ATTEMPTS;
        await tx.otpChallenge.updateMany({
          // Guarding on the observed `attempts` makes this an optimistic
          // update: a concurrent wrong guess that already incremented the
          // counter causes this one to match zero rows rather than
          // overwriting it with a stale value and granting a free attempt.
          where: { id: challenge.id, consumedAt: null, attempts: challenge.attempts },
          data: { attempts, ...(exhausted ? { consumedAt: now } : {}) },
        });
        if (exhausted) {
          throw new HttpException(
            ATTEMPTS_EXHAUSTED,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new UnauthorizedException(INVALID_CODE);
      }

      // The `consumedAt: null` guard is the single-use mechanism. Two
      // simultaneous correct submissions both reach here; the second matches
      // zero rows once the first commits.
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) throw new UnauthorizedException(INVALID_CODE);

      const identity =
        channel === OtpChannel.SMS
          ? { phone: normalized }
          : { email: normalized };

      const existing = await tx.user.findFirst({
        where: { ...identity, deletedAt: null },
        select: { id: true },
      });

      const user =
        existing ??
        (await tx.user.create({
          data: {
            ...identity,
            displayName: placeholderDisplayName(normalized, channel),
            // They just proved control of the destination.
            isVerified: true,
            // passwordHash intentionally omitted — passwordless.
          },
          select: { id: true },
        }));

      await tx.otpChallenge.updateMany({
        where: { id: challenge.id },
        data: { userId: user.id },
      });

      return { userId: user.id, isNewUser: existing === null };
    });
  }
```

Add this helper at the bottom of the file, outside the class:

```ts
/** A non-empty display name for a lazily-created user. Editable later. */
function placeholderDisplayName(
  destination: string,
  channel: OtpChannel,
): string {
  if (channel === OtpChannel.EMAIL) return destination.split('@')[0];
  return `ผู้ใช้${destination.slice(-4)}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/flick-api && npm test -- otp.service`
Expected: PASS (18 tests — 9 from Task 7, 9 here).

- [ ] **Step 5: Run lint and the full suite**

Run: `cd apps/flick-api && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/src/auth/otp/otp.service.ts apps/flick-api/src/auth/otp/otp.service.spec.ts
git commit -m "feat(auth): implement single-use, attempt-capped OTP verification"
```

---

### Task 9: `OtpModule`

**Files:**
- Create: `apps/flick-api/src/auth/otp/otp.module.ts`

**Interfaces:**
- Consumes: `OtpService` (Tasks 7–8), `ConsoleOtpDeliveryAdapter` (Task 5), `OTP_DELIVERY_PORT` (Task 5)
- Produces: `OtpModule`, exporting `OtpService` and `OTP_DELIVERY_PORT` (the latter so the e2e suite can resolve the console adapter and read the delivered code)

Phase 3 replaces the factory body with real adapter selection. For now it always returns the console adapter.

- [ ] **Step 1: Write the module**

Create `apps/flick-api/src/auth/otp/otp.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OtpService } from './otp.service';
import { OTP_DELIVERY_PORT } from './otp-delivery.port';
import { ConsoleOtpDeliveryAdapter } from './adapters/console-delivery.adapter';

/**
 * Delivery adapter selection lives here, mirroring the Redis-vs-in-memory
 * branch in movies.module.ts. Phase 3 extends the factory with real SMS and
 * email adapters; until then every environment logs the code.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    OtpService,
    { provide: OTP_DELIVERY_PORT, useClass: ConsoleOtpDeliveryAdapter },
  ],
  // OTP_DELIVERY_PORT is exported so the e2e harness can resolve the console
  // adapter and read back the code it "delivered".
  exports: [OtpService, OTP_DELIVERY_PORT],
})
export class OtpModule {}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/flick-api && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/flick-api/src/auth/otp/otp.module.ts
git commit -m "feat(auth): wire OtpModule with console delivery"
```

---

## Phase 2 — Passwordless Auth Endpoints + Frontend

`/auth/otp/request` and `/auth/otp/verify` replace `/auth/login` and `/auth/register`. The password path is **removed**, not deprecated.

**Before starting this phase**, confirm the spec's open item still holds:

```bash
ls apps/flick-api/prisma/migrations/
```

If `0_init` (plus the Task 1 migration) is still all there is, there are no production password users and removal is safe. If other migrations exist, **stop** and resolve the migration path with the user before continuing.

---

### Task 10: OTP DTOs

**Files:**
- Create: `apps/flick-api/src/auth/dto/request-otp.dto.ts`
- Create: `apps/flick-api/src/auth/dto/verify-otp.dto.ts`

**Interfaces:**
- Consumes: `OtpChannel` (Task 1)
- Produces: `RequestOtpDto { destination: string; channel?: OtpChannel }`, `VerifyOtpDto { destination: string; channel?: OtpChannel; ref: string; code: string }`

The global `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true` (`main.ts:23-25`), so any field not declared here is rejected outright. That is the mechanism that keeps an `amount`-style field from ever being smuggled in.

- [ ] **Step 1: Write both DTOs**

Create `apps/flick-api/src/auth/dto/request-otp.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OtpChannel } from '@prisma/client';

export class RequestOtpDto {
  /** A phone number in any Thai format, or an email. Normalized server-side. */
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  destination: string;

  @IsOptional()
  @IsEnum(OtpChannel)
  channel?: OtpChannel;
}
```

Create `apps/flick-api/src/auth/dto/verify-otp.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { OtpChannel } from '@prisma/client';

export class VerifyOtpDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  destination: string;

  @IsOptional()
  @IsEnum(OtpChannel)
  channel?: OtpChannel;

  @IsString()
  @Length(4, 4)
  ref: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/flick-api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/flick-api/src/auth/dto/request-otp.dto.ts apps/flick-api/src/auth/dto/verify-otp.dto.ts
git commit -m "feat(auth): add OTP request and verify DTOs"
```

---

### Task 11: `AuthService` — replace password methods with OTP methods

**Files:**
- Modify: `apps/flick-api/src/auth/auth.service.ts` (full rewrite)
- Modify: `apps/flick-api/src/auth/auth.service.spec.ts` (full rewrite)
- Delete: `apps/flick-api/src/auth/dto/login.dto.ts`, `apps/flick-api/src/auth/dto/register.dto.ts`

**Interfaces:**
- Consumes: `OtpService.request`/`OtpService.verify` (Tasks 7–8), `RequestOtpDto`/`VerifyOtpDto` (Task 10), `UsersService.findById`, `JwtService.signAsync`
- Produces:
  - `AuthService.requestOtp(dto: RequestOtpDto, ipAddress: string): Promise<OtpRequestResult>`
  - `AuthService.verifyOtp(dto: VerifyOtpDto): Promise<{ success: true; user: { id: string; email: string | null; phone: string | null; displayName: string }; isNewUser: boolean; access_token: string }>`
- Removed: `AuthService.register`, `AuthService.login`, `RegisterDto`, `LoginDto`

**Note:** `register()` currently leaks account existence with `'อีเมลนี้ถูกใช้งานแล้ว (Email already in use)'` (`auth.service.ts:22-24`). Deleting the method deletes the leak — there is nothing to preserve.

- [ ] **Step 1: Write the failing test**

Replace the contents of `apps/flick-api/src/auth/auth.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpChannel } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp/otp.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findById: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let otpService: { request: jest.Mock; verify: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('tok') };
    otpService = { request: jest.fn(), verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: OtpService, useValue: otpService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('defaults the channel to SMS and forwards the caller IP', async () => {
    otpService.request.mockResolvedValue({ ref: 'AB2C', expiresIn: 300 });

    await service.requestOtp({ destination: '0812345678' }, '1.2.3.4');

    expect(otpService.request).toHaveBeenCalledWith({
      destination: '0812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });
  });

  it('returns only ref and expiresIn from a request', async () => {
    otpService.request.mockResolvedValue({ ref: 'AB2C', expiresIn: 300 });
    const result = await service.requestOtp(
      { destination: '0812345678' },
      '1.2.3.4',
    );
    expect(Object.keys(result).sort()).toEqual(['expiresIn', 'ref']);
  });

  it('issues a token for a verified user and never exposes passwordHash', async () => {
    otpService.verify.mockResolvedValue({ userId: 'u1', isNewUser: false });
    usersService.findById.mockResolvedValue({
      id: 'u1',
      email: null,
      phone: '+66812345678',
      displayName: 'ผู้ใช้5678',
      passwordHash: null,
    });

    const result = await service.verifyOtp({
      destination: '0812345678',
      ref: 'AB2C',
      code: '123456',
    });

    expect(result.access_token).toBe('tok');
    expect(result.isNewUser).toBe(false);
    expect(result.user).toEqual({
      id: 'u1',
      email: null,
      phone: '+66812345678',
      displayName: 'ผู้ใช้5678',
    });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });

  it('reports isNewUser for a lazily created account', async () => {
    otpService.verify.mockResolvedValue({ userId: 'u2', isNewUser: true });
    usersService.findById.mockResolvedValue({
      id: 'u2',
      email: null,
      phone: '+66899999999',
      displayName: 'ผู้ใช้9999',
    });

    const result = await service.verifyOtp({
      destination: '0899999999',
      ref: 'AB2C',
      code: '123456',
    });
    expect(result.isNewUser).toBe(true);
  });

  it('rejects when the verified user has vanished', async () => {
    otpService.verify.mockResolvedValue({ userId: 'gone', isNewUser: false });
    usersService.findById.mockResolvedValue(null);

    await expect(
      service.verifyOtp({
        destination: '0812345678',
        ref: 'AB2C',
        code: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('no longer exposes password authentication', () => {
    expect((service as unknown as Record<string, unknown>).login).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).register,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- auth.service`
Expected: FAIL — `service.requestOtp is not a function`.

- [ ] **Step 3: Rewrite the service**

Replace the entire contents of `apps/flick-api/src/auth/auth.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpChannel } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { OtpService, type OtpRequestResult } from './otp/otp.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

export interface OtpAuthResult {
  success: true;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
  };
  isNewUser: boolean;
  access_token: string;
}

/**
 * Passwordless authentication. There is no password path: proving control of
 * a phone number (or of an email already verified on the account) is the only
 * way to obtain a session.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
  ) {}

  requestOtp(dto: RequestOtpDto, ipAddress: string): Promise<OtpRequestResult> {
    return this.otpService.request({
      destination: dto.destination,
      channel: dto.channel ?? OtpChannel.SMS,
      ipAddress,
    });
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<OtpAuthResult> {
    const { userId, isNewUser } = await this.otpService.verify({
      destination: dto.destination,
      channel: dto.channel ?? OtpChannel.SMS,
      ref: dto.ref,
      code: dto.code,
    });

    const user = await this.usersService.findById(userId);
    // Only reachable if the row was deleted between the verify transaction
    // committing and this read — but a token must never be minted for a user
    // we cannot load.
    if (!user) throw new UnauthorizedException();

    const payload = { sub: user.id, email: user.email };
    return {
      success: true,
      // Explicitly projected, never spread: spreading the Prisma row would
      // put passwordHash on the wire the moment someone adds a field.
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
      },
      isNewUser,
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
```

- [ ] **Step 4: Delete the password DTOs**

```bash
git rm apps/flick-api/src/auth/dto/login.dto.ts apps/flick-api/src/auth/dto/register.dto.ts
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/flick-api && npm test -- auth.service`
Expected: PASS (6 tests). `auth.controller.spec.ts` will still fail — Task 12 fixes it.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/src/auth/auth.service.ts apps/flick-api/src/auth/auth.service.spec.ts apps/flick-api/src/auth/dto/
git commit -m "feat(auth): replace password login with passwordless OTP in AuthService"
```

---

### Task 12: `AuthController` — OTP endpoints, password endpoints removed

**Files:**
- Modify: `apps/flick-api/src/auth/auth.controller.ts`
- Modify: `apps/flick-api/src/auth/auth.controller.spec.ts`
- Modify: `apps/flick-api/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `AuthService.requestOtp`/`verifyOtp` (Task 11), `OtpModule` (Task 9)
- Produces: `POST /auth/otp/request` → `{ ref, expiresIn }`; `POST /auth/otp/verify` → `Set-Cookie: access_token` + `{ success, user, isNewUser }`
- Removed: `POST /auth/register`, `POST /auth/login`

`setTokenCookie` (`auth.controller.ts:37-45`) is reused unchanged. Both endpoints keep the existing `@Throttle({ default: { limit: 5, ttl: 60_000 } })` as a coarse per-IP guard — the real per-destination limits live in `OtpService`.

- [ ] **Step 1: Write the failing test**

Replace the contents of `apps/flick-api/src/auth/auth.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    authService = { requestOtp: jest.fn(), verifyOtp: jest.fn() };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: () => '7d' } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('passes the caller IP through to the service', async () => {
    authService.requestOtp.mockResolvedValue({ ref: 'AB2C', expiresIn: 300 });

    await controller.requestOtp({ destination: '0812345678' }, {
      ip: '9.9.9.9',
    } as never);

    expect(authService.requestOtp).toHaveBeenCalledWith(
      { destination: '0812345678' },
      '9.9.9.9',
    );
  });

  it('sets an HttpOnly cookie and strips the token from the body', async () => {
    authService.verifyOtp.mockResolvedValue({
      success: true,
      user: { id: 'u1', email: null, phone: '+66812345678', displayName: 'A' },
      isNewUser: false,
      access_token: 'tok',
    });

    const body = await controller.verifyOtp(
      { destination: '0812345678', ref: 'AB2C', code: '123456' },
      res as unknown as Response,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'tok',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(JSON.stringify(body)).not.toContain('tok');
    expect(JSON.stringify(body)).not.toContain('access_token');
    expect(body).toEqual({
      success: true,
      user: { id: 'u1', email: null, phone: '+66812345678', displayName: 'A' },
      isNewUser: false,
    });
  });

  it('no longer exposes password endpoints', () => {
    const asRecord = controller as unknown as Record<string, unknown>;
    expect(asRecord.login).toBeUndefined();
    expect(asRecord.register).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- auth.controller`
Expected: FAIL — `controller.requestOtp is not a function`.

- [ ] **Step 3: Rewrite the controller's endpoints**

In `apps/flick-api/src/auth/auth.controller.ts`, replace the imports of the deleted DTOs and both password handlers.

Change the import block (lines 1–20) to:

```ts
import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import ms from 'ms';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './current-user.decorator';
import { DEFAULT_JWT_EXPIRES_IN } from './jwt.config';
```

Replace both the `register` handler (lines 47–59) and the `login` handler (lines 61–74) with:

```ts
  /**
   * Issues a code to `destination`. The response is byte-identical whether or
   * not an account exists — see OtpService.request. The @Throttle here is a
   * coarse per-IP guard; the per-destination cooldown and caps that actually
   * stop SMS-bombing live in OtpService.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.authService.requestOtp(dto, req.ip ?? 'unknown');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('otp/verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(dto);
    this.setTokenCookie(res, result.access_token);
    // The token goes in an HttpOnly cookie and nowhere else — never in a body
    // a script could read.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { access_token: _, ...safeResult } = result;
    return safeResult;
  }
```

- [ ] **Step 4: Import `OtpModule` in `AuthModule`**

In `apps/flick-api/src/auth/auth.module.ts`, add the import and list it:

```ts
import { OtpModule } from './otp/otp.module';
```

```ts
  imports: [
    UsersModule,
    OtpModule,
    PassportModule,
    JwtModule.registerAsync({
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/flick-api && npm test -- auth.controller`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the whole unit suite and lint**

Run: `cd apps/flick-api && npm run lint && npm test`
Expected: PASS. (`npm run test:e2e` still fails — Task 13.)

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/src/auth/auth.controller.ts apps/flick-api/src/auth/auth.controller.spec.ts apps/flick-api/src/auth/auth.module.ts
git commit -m "feat(auth): expose OTP endpoints and remove password login"
```

---

### Task 13: Seed + e2e round-trip through the real OTP flow

**Files:**
- Modify: `apps/flick-api/prisma/seed.ts:252-259`
- Modify: `apps/flick-api/test/auth.e2e-spec.ts` (full rewrite)

**Interfaces:**
- Consumes: `POST /auth/otp/request`, `POST /auth/otp/verify` (Task 12), `ConsoleOtpDeliveryAdapter.lastCodeFor` (Task 5)
- Produces: a green e2e suite proving request→deliver→verify→cookie→`/auth/me` works end to end with no SMS vendor

The seeded user currently has a `passwordHash` and no `phone` (`seed.ts:252-259`), which no longer describes a valid login. Give it a phone instead.

- [ ] **Step 1: Update the seed user**

In `apps/flick-api/prisma/seed.ts`, replace the `prisma.user.create` block:

```ts
  await prisma.user.create({
    data: {
      id: 'e2e-free-user',
      email: 'e2e-free@flick.test',
      // The phone IS the login identity now — stored normalized, exactly as
      // OtpService writes it.
      phone: '+66800000001',
      displayName: 'E2E Free User',
      isVerified: true,
      // passwordHash intentionally absent — passwordless.
    },
  });
```

If `bcrypt` is now unused in `seed.ts`, remove its import.

- [ ] **Step 2: Rewrite the e2e spec**

Replace the contents of `apps/flick-api/test/auth.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';

describe('Auth OTP (e2e)', () => {
  let app: INestApplication<App>;
  let delivery: ConsoleOtpDeliveryAdapter;

  // Matches the seeded user. E.164 already normalized.
  const seededPhone = '+66800000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts applies this at bootstrap; the e2e harness must too, or the
    // JwtStrategy cookie extractor never sees req.cookies.
    app.use(cookieParser());
    await app.init();

    // The console adapter is the only way to learn a delivered code: the DB
    // stores a bcrypt hash. strict:false because the provider lives in
    // OtpModule, not the root module.
    delivery = app.get<ConsoleOtpDeliveryAdapter>(OTP_DELIVERY_PORT, {
      strict: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Runs a full request→verify round-trip and returns the Set-Cookie header. */
  async function loginViaOtp(phone: string) {
    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(200);

    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(phone);
    expect(code).toBeDefined();

    return request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code })
      .expect(200);
  }

  it('rejects a protected route without a cookie', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('completes a request/verify round-trip and authorizes /auth/me', async () => {
    const verified = await loginViaOtp(seededPhone);
    const cookies = verified.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookies)
      .expect(200);

    expect((me.body as { id: string }).id).toBe('e2e-free-user');
  });

  it('never returns the access token in a response body', async () => {
    const verified = await loginViaOtp(seededPhone);
    expect(JSON.stringify(verified.body)).not.toContain('access_token');
    expect(verified.headers['set-cookie']).toBeDefined();
  });

  it('answers identically for a destination with no account', async () => {
    // Enumeration safety: this response must be indistinguishable in shape
    // from the seeded (existing) user's.
    const unknown = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: '+66800000009' })
      .expect(200);

    expect(Object.keys(unknown.body as object).sort()).toEqual([
      'expiresIn',
      'ref',
    ]);
  });

  it('rejects a wrong code and refuses to reuse a consumed one', async () => {
    const phone = '+66800000002';
    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(200);
    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(phone) as string;

    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code: '000000' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code })
      .expect(200);

    // Replay of the now-consumed challenge.
    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code })
      .expect(401);
  });

  it('enforces the per-destination cooldown', async () => {
    const phone = '+66800000003';
    await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(429);
  });
});
```

- [ ] **Step 3: Reseed and run the e2e suite**

Run: `cd apps/flick-api && npm run db:seed && npm run test:e2e`
Expected: PASS. If `entitlement.e2e-spec.ts` logged in with a password, update it to use the same `loginViaOtp` pattern.

- [ ] **Step 4: Commit**

```bash
git add apps/flick-api/prisma/seed.ts apps/flick-api/test/
git commit -m "test(auth): exercise the OTP flow end to end without an SMS vendor"
```

---

### Task 14: Frontend API contract + auth client

**Files:**
- Modify: `apps/flick-app/src/types/index.ts`
- Modify: `apps/flick-app/src/types/api.ts:22-54`, `:158-170`
- Modify: `apps/flick-app/src/features/auth/api.ts`
- Modify: `apps/flick-app/src/features/auth/index.ts`

**Interfaces:**
- Consumes: `POST /auth/otp/request`, `POST /auth/otp/verify` (Task 12)
- Produces:
  - types `OtpRequestResponse { ref: string; expiresIn: number }`, `OtpVerifyResponse`
  - `requestOtp(destination: string): Promise<OtpRequestResult>` where `OtpRequestResult = { success: true; ref: string; expiresIn: number } | { success: false; error: string }`
  - `verifyOtp(destination: string, ref: string, code: string): Promise<OtpVerifyResult>` where `OtpVerifyResult = { success: true; user: AuthUser; isNewUser: boolean } | { success: false; error: string }`
  - `logout()` — unchanged
- Removed: `login`, `register`

Read `apps/flick-app/node_modules/next/dist/docs/` before editing frontend files (see Global Constraints). This task touches no Next-specific API, but the next one does.

- [ ] **Step 1: Add the response types**

In `apps/flick-app/src/types/index.ts`, after `AuthMutationResponse` (line 14), add:

```ts
/** Body of POST /auth/otp/request. Identical whether or not an account exists. */
export interface OtpRequestResponse {
  ref: string;
  expiresIn: number;
}

/** Body of POST /auth/otp/verify. The token itself is in an HttpOnly cookie. */
export interface OtpVerifyResponse {
  success: boolean;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'displayName'> & {
    phone: string | null;
  };
  isNewUser: boolean;
}
```

- [ ] **Step 2: Update the path union and response map**

In `apps/flick-app/src/types/api.ts`, replace `'/auth/login'` and `'/auth/register'` in the `ApiPath` union with the two OTP paths:

```ts
export type ApiPath =
  | '/auth/otp/request'
  | '/auth/otp/verify'
  | '/auth/logout'
  | '/auth/me'
```

(leave the rest of the union unchanged), and replace the first `ApiResponse` branch:

```ts
export type ApiResponse<Path extends ApiPath> =
  Path extends '/auth/otp/request' ? OtpRequestResponse
  : Path extends '/auth/otp/verify' ? OtpVerifyResponse
  : Path extends '/auth/logout' ? { success: boolean }
  : Path extends '/auth/me' ? AuthenticatedUser
```

Add the two new types to the import block at the top of the file.

- [ ] **Step 3: Update the runtime decoder**

In `decodeApiResponse`, replace the `'/auth/me' || '/auth/login' || '/auth/register'` branch (lines 158–165) with:

```ts
  if (path === '/auth/otp/request') {
    const otp = requireRecord(value, 'otp request');
    if (typeof otp.ref !== 'string') throw new TypeError('Invalid otp ref');
    requireNumber(otp, 'expiresIn');
    return otp as ApiResponse<Path>;
  }
  if (path === '/auth/me' || path === '/auth/otp/verify') {
    const envelope = requireRecord(value, 'authentication');
    const user =
      path === '/auth/me' ? envelope : requireRecord(envelope.user, 'authentication user');
    if (typeof user.id !== 'string' || typeof user.displayName !== 'string') {
      throw new TypeError('Invalid authentication user');
    }
    return envelope as ApiResponse<Path>;
  }
```

- [ ] **Step 4: Rewrite the auth client**

Replace `login` and `register` in `apps/flick-app/src/features/auth/api.ts` with:

```ts
export type OtpRequestResult =
  | { success: true; ref: string; expiresIn: number }
  | { success: false; error: string };

export type OtpVerifyResult =
  | { success: true; user: AuthUser; isNewUser: boolean }
  | { success: false; error: string };

/**
 * Asks the API to send a code. The response is deliberately the same whether
 * or not an account exists, so the UI must never branch on "user found".
 */
export async function requestOtp(destination: string): Promise<OtpRequestResult> {
  try {
    const data = await apiFetch('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ destination }),
    });
    return { success: true, ref: data.ref, expiresIn: data.expiresIn };
  } catch (err) {
    return toResult(err, 'ไม่สามารถส่งรหัสได้ กรุณาลองใหม่');
  }
}

export async function verifyOtp(
  destination: string,
  ref: string,
  code: string,
): Promise<OtpVerifyResult> {
  try {
    const data = await apiFetch('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ destination, ref, code }),
    });
    clearLegacyLocalState();
    return { success: true, user: data.user, isNewUser: data.isNewUser };
  } catch (err) {
    return toResult(err, 'รหัสไม่ถูกต้องหรือหมดอายุ');
  }
}
```

Update `AuthUser` in that file to include `phone`, and widen `toResult`'s return type so it satisfies both result unions:

```ts
interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
}

function toResult(err: unknown, fallback: string): { success: false; error: string } {
  if (err instanceof ApiError) {
    return { success: false, error: err.message || fallback };
  }
  return { success: false, error: NETWORK_ERROR };
}
```

Delete the now-unused `AuthResult` interface.

- [ ] **Step 5: Update the barrel export**

Replace `apps/flick-app/src/features/auth/index.ts`:

```ts
export { logout, requestOtp, verifyOtp } from './api';
```

- [ ] **Step 6: Type-check**

Run: `cd apps/flick-app && npx tsc --noEmit`
Expected: FAIL, but **only** in `src/app/login/page.tsx` and `src/app/register/page.tsx` (they still import `login`/`register`). Task 15 fixes those. Any other file erroring means something was missed.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-app/src/types/ apps/flick-app/src/features/auth/
git commit -m "feat(auth): switch the frontend API contract to OTP endpoints"
```

---

### Task 15: Login page as phone → code; delete the register page

**Files:**
- Modify: `apps/flick-app/src/app/login/page.tsx` (full rewrite)
- Delete: `apps/flick-app/src/app/register/page.tsx`
- Modify: `apps/flick-app/src/app/LandingClient.tsx:109`

**Interfaces:**
- Consumes: `requestOtp`, `verifyOtp` (Task 14)
- Produces: a two-step login screen. No new exports.

There is no separate registration any more: a first successful verify creates the account. Every `/register` link must point at `/login`.

**Read `apps/flick-app/node_modules/next/dist/docs/` before writing this file** — it is a client component using `useRouter` from `next/navigation`, and this Next version may have changed those APIs.

- [ ] **Step 1: Rewrite the login page**

Replace the contents of `apps/flick-app/src/app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { requestOtp, verifyOtp } from '@/features/auth';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

type Step = 'phone' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [ref, setRef] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const handleRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!phone) {
      setError('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }
    setBusy(true);
    setError('');
    const result = await requestOtp(phone);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    // The API answers identically for known and unknown numbers, so there is
    // nothing here to branch on — always advance to the code step.
    setRef(result.ref);
    setStep('code');
  };

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('กรุณากรอกรหัส 6 หลัก');
      return;
    }
    setBusy(true);
    setError('');
    const result = await verifyOtp(phone, ref, code);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    // A brand-new account goes to plan selection; a returning user goes home.
    router.replace(result.isNewUser ? '/subscribe' : '/home');
    router.refresh();
  };

  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ink px-6 py-12"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 100% 45% at 50% 0%, rgba(204,51,0,0.16), transparent 70%)',
      }}
    >
      <Link
        href="/"
        aria-label="กลับหน้าแรก"
        className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full text-fg-dim transition-colors hover:text-fg"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <Icon name="chevronLeft" size={22} />
      </Link>

      <div className="text-3xl font-extrabold tracking-tight text-brand-ink">Flick</div>

      <div className="mt-7 w-full max-w-sm rounded-2xl border border-hairline bg-ink-1/70 p-6 backdrop-blur-xl">
        <h1 className="text-title font-display">
          {step === 'phone' ? 'เข้าสู่ระบบ' : 'ใส่รหัสยืนยัน'}
        </h1>
        <p className="mt-1 text-sm text-fg-mute">
          {step === 'phone'
            ? 'กรอกเบอร์โทรศัพท์เพื่อรับรหัสยืนยัน'
            : `ส่งรหัส 6 หลักไปที่ ${phone} แล้ว (รหัสอ้างอิง ${ref})`}
        </p>

        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail">
            <Icon name="alertCircle" size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={handleRequest} className="mt-5 flex flex-col gap-3">
            <div className="relative flex items-center">
              <Icon name="phone" size={18} className="pointer-events-none absolute left-3.5 text-fg-mute" />
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className="h-12 w-full rounded-xl border border-hairline bg-ink-2 pl-11 pr-4 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink"
                placeholder="เบอร์โทรศัพท์"
                aria-label="เบอร์โทรศัพท์"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" disabled={busy}>
              {busy ? 'กำลังส่ง...' : 'ขอรหัสยืนยัน'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="mt-5 flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="h-12 w-full rounded-xl border border-hairline bg-ink-2 px-4 text-center text-xl tracking-[0.5em] text-fg outline-none placeholder:tracking-normal placeholder:text-fg-mute focus:border-brand-ink"
              placeholder="000000"
              aria-label="รหัสยืนยัน 6 หลัก"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" disabled={busy}>
              {busy ? 'กำลังตรวจสอบ...' : 'ยืนยัน'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError('');
              }}
              className="mt-1 text-sm text-fg-dim transition-colors hover:text-fg"
            >
              เปลี่ยนเบอร์โทรศัพท์
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 flex justify-center gap-4 text-xs text-fg-mute">
        <span>เงื่อนไขการใช้งาน</span>
        <span>นโยบายความเป็นส่วนตัว</span>
      </div>
    </div>
  );
}
```

If `Icon` has no `phone` glyph, use an existing one (check `apps/flick-app/src/components/ui/Icon.tsx` for the available names) rather than inventing a name.

- [ ] **Step 2: Delete the register page**

```bash
git rm apps/flick-app/src/app/register/page.tsx
```

- [ ] **Step 3: Repoint the landing CTA**

In `apps/flick-app/src/app/LandingClient.tsx:109`, change `href="/register"` to `href="/login"`. Update the surrounding label if it reads "สมัครสมาชิก" in a way that no longer makes sense — a single screen now does both.

- [ ] **Step 4: Confirm no dangling references**

Run: `cd apps/flick-app && grep -rn "'/register'\|\"/register\"\|features/auth'" src/`
Expected: no `/register` hits; only `LogoutButton.tsx` and `login/page.tsx` import from `@/features/auth`.

- [ ] **Step 5: Type-check, lint, test, build**

Run: `cd apps/flick-app && npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-app/src/app/
git commit -m "feat(auth): rebuild login as a phone-then-code flow and drop registration"
```

---

## Phase 3 — Real Delivery Adapters

CI and local development keep using the console adapter; production gets real ones.

---

### Task 16: SMS and email delivery adapters

**Files:**
- Create: `apps/flick-api/src/auth/otp/adapters/sms-delivery.adapter.ts`
- Create: `apps/flick-api/src/auth/otp/adapters/email-delivery.adapter.ts`
- Test: `apps/flick-api/src/auth/otp/adapters/sms-delivery.adapter.spec.ts`

**Interfaces:**
- Consumes: `OtpDeliveryPort` (Task 5), `maskDestination` (Task 2), `ConfigService`
- Produces: `HttpOtpDeliveryAdapter` (SMS, generic HTTP vendor), `EmailOtpDeliveryAdapter`

> **Spec TBD resolved here.** The spec deferred the production SMS vendor. Rather than block on that decision, the SMS adapter targets a **generic HTTP JSON vendor** configured entirely by env (`OTP_SMS_ENDPOINT`, `OTP_SMS_API_KEY`, `OTP_SMS_SENDER`). Nearly every Thai SMS provider (ThaiBulkSMS, SMSMKT, Twilio) accepts a POST of this shape. **When the vendor is chosen, revisit this task** — if their contract differs, this file is the only one that changes.

- [ ] **Step 1: Write the failing test**

Create `apps/flick-api/src/auth/otp/adapters/sms-delivery.adapter.spec.ts`:

```ts
import { OtpChannel } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { HttpOtpDeliveryAdapter } from './sms-delivery.adapter';

describe('HttpOtpDeliveryAdapter', () => {
  const config = {
    getOrThrow: (key: string) =>
      ({
        OTP_SMS_ENDPOINT: 'https://sms.example/send',
        OTP_SMS_API_KEY: 'secret-key',
      })[key] as string,
    get: (key: string, fallback?: string) =>
      key === 'OTP_SMS_SENDER' ? 'Flick' : fallback,
  } as unknown as ConfigService;

  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('posts the code to the configured endpoint', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const adapter = new HttpOtpDeliveryAdapter(config);

    await adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sms.example/send');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.to).toBe('+66812345678');
    expect(body.message).toContain('123456');
    expect(body.message).toContain('AB2C');
  });

  it('throws when the vendor rejects the send', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));
    const adapter = new HttpOtpDeliveryAdapter(config);

    await expect(
      adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C'),
    ).rejects.toThrow();
  });

  it('gives up rather than hanging when the vendor stalls', async () => {
    fetchSpy.mockImplementation((_url, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      }),
    );
    const adapter = new HttpOtpDeliveryAdapter(config);

    await expect(
      adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C'),
    ).rejects.toThrow();
  }, 15_000);

  it('never puts the code or the full destination in an error message', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));
    const adapter = new HttpOtpDeliveryAdapter(config);

    await expect(
      adapter.send('+66812345678', OtpChannel.SMS, '123456', 'AB2C'),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('123456') as unknown as string,
      }),
    );
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- sms-delivery`
Expected: FAIL — `Cannot find module './sms-delivery.adapter'`.

- [ ] **Step 3: Write the SMS adapter**

Create `apps/flick-api/src/auth/otp/adapters/sms-delivery.adapter.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannel } from '@prisma/client';
import { maskDestination } from '../destination';
import type { OtpDeliveryPort } from '../otp-delivery.port';

/** A stalled vendor must not hold the request (and its DB connection) open. */
const SEND_TIMEOUT_MS = 8000;

/**
 * Generic HTTP JSON SMS vendor. The specific provider is still an open
 * decision (see the spec); this adapter is deliberately the only file that
 * knows the wire format, so switching vendors is a one-file change.
 */
@Injectable()
export class HttpOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger('OtpDelivery');

  constructor(private readonly config: ConfigService) {}

  async send(
    destination: string,
    _channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    const endpoint = this.config.getOrThrow<string>('OTP_SMS_ENDPOINT');
    const apiKey = this.config.getOrThrow<string>('OTP_SMS_API_KEY');
    const sender = this.config.get<string>('OTP_SMS_SENDER', 'Flick');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: destination,
        from: sender,
        message: `รหัสยืนยัน Flick: ${code} (อ้างอิง ${ref}) หมดอายุใน 5 นาที`,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Neither the code nor the full number appears here: this string ends up
      // in logs and in an exception trace.
      this.logger.error(
        `SMS vendor rejected send to ${maskDestination(destination)} (HTTP ${response.status})`,
      );
      throw new Error(`SMS delivery failed with HTTP ${response.status}`);
    }
  }
}
```

- [ ] **Step 4: Run the SMS tests**

Run: `cd apps/flick-api && npm test -- sms-delivery`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the email adapter**

Create `apps/flick-api/src/auth/otp/adapters/email-delivery.adapter.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpChannel } from '@prisma/client';
import { maskDestination } from '../destination';
import type { OtpDeliveryPort } from '../otp-delivery.port';

const SEND_TIMEOUT_MS = 8000;

/**
 * Transactional email over a generic HTTP JSON API. Only ever called for an
 * address already verified on an account — OtpService enforces that; this
 * adapter must not re-decide it.
 */
@Injectable()
export class EmailOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger('OtpDelivery');

  constructor(private readonly config: ConfigService) {}

  async send(
    destination: string,
    _channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    const endpoint = this.config.getOrThrow<string>('OTP_EMAIL_ENDPOINT');
    const apiKey = this.config.getOrThrow<string>('OTP_EMAIL_API_KEY');
    const from = this.config.get<string>('OTP_EMAIL_FROM', 'no-reply@flick.co.th');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: destination,
        from,
        subject: `รหัสยืนยัน Flick (${ref})`,
        text: `รหัสยืนยันของคุณคือ ${code}\nรหัสอ้างอิง: ${ref}\nรหัสนี้หมดอายุใน 5 นาที`,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      this.logger.error(
        `Email vendor rejected send to ${maskDestination(destination)} (HTTP ${response.status})`,
      );
      throw new Error(`Email delivery failed with HTTP ${response.status}`);
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/src/auth/otp/adapters/
git commit -m "feat(auth): add HTTP SMS and email OTP delivery adapters"
```

---

### Task 17: Config-driven adapter selection + env validation

**Files:**
- Create: `apps/flick-api/src/auth/otp/adapters/routing-delivery.adapter.ts`
- Modify: `apps/flick-api/src/auth/otp/otp.module.ts`
- Modify: `apps/flick-api/src/common/config.validation.ts`
- Test: `apps/flick-api/src/common/config.validation.spec.ts` (create)

**Interfaces:**
- Consumes: `ConsoleOtpDeliveryAdapter` (Task 5), `HttpOtpDeliveryAdapter`/`EmailOtpDeliveryAdapter` (Task 16)
- Produces: `RoutingOtpDeliveryAdapter`, an `OTP_DELIVERY_PORT` factory that branches on config, and `validateEnv` rules that make a misconfigured production deploy fail at boot

**The failure this prevents:** deploying to production with `OTP_DELIVERY` unset or set to `console`. The console adapter delivers nothing, so every login silently breaks while the API happily returns 200. Boot-time validation turns a silent outage into a crash on startup.

- [ ] **Step 1: Write the routing adapter**

Create `apps/flick-api/src/auth/otp/adapters/routing-delivery.adapter.ts`:

```ts
import { OtpChannel } from '@prisma/client';
import type { OtpDeliveryPort } from '../otp-delivery.port';

/**
 * OtpService depends on ONE delivery port but supports two channels. This
 * composite keeps that seam in one place instead of teaching the service
 * about vendors.
 */
export class RoutingOtpDeliveryAdapter implements OtpDeliveryPort {
  constructor(
    private readonly sms: OtpDeliveryPort,
    private readonly email: OtpDeliveryPort,
  ) {}

  send(
    destination: string,
    channel: OtpChannel,
    code: string,
    ref: string,
  ): Promise<void> {
    const target = channel === OtpChannel.EMAIL ? this.email : this.sms;
    return target.send(destination, channel, code, ref);
  }
}
```

- [ ] **Step 2: Replace the module's provider with a factory**

Replace the contents of `apps/flick-api/src/auth/otp/otp.module.ts`:

```ts
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OtpService } from './otp.service';
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from './otp-delivery.port';
import { ConsoleOtpDeliveryAdapter } from './adapters/console-delivery.adapter';
import { HttpOtpDeliveryAdapter } from './adapters/sms-delivery.adapter';
import { EmailOtpDeliveryAdapter } from './adapters/email-delivery.adapter';
import { RoutingOtpDeliveryAdapter } from './adapters/routing-delivery.adapter';

const logger = new Logger('OtpDelivery');

@Module({
  imports: [ConfigModule],
  providers: [
    OtpService,
    {
      provide: OTP_DELIVERY_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OtpDeliveryPort => {
        // Same shape as the Redis-vs-in-memory branch in movies.module.ts:
        // one config read decides which implementation the app runs with.
        const mode = config.get<string>('OTP_DELIVERY', 'console');

        if (mode === 'console') {
          // validateEnv refuses this combination in production, so reaching
          // here means dev or CI.
          logger.warn(
            'OTP delivery is CONSOLE — codes are logged, not sent. Development only.',
          );
          return new ConsoleOtpDeliveryAdapter();
        }

        return new RoutingOtpDeliveryAdapter(
          new HttpOtpDeliveryAdapter(config),
          new EmailOtpDeliveryAdapter(config),
        );
      },
    },
  ],
  exports: [OtpService, OTP_DELIVERY_PORT],
})
export class OtpModule {}
```

- [ ] **Step 3: Write the failing config test**

Create `apps/flick-api/src/common/config.validation.spec.ts`:

```ts
import { validateEnv } from './config.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost/flick',
    JWT_SECRET: 'a'.repeat(32),
    CORS_ORIGIN: 'https://flick.co.th',
  };

  it('accepts console delivery outside production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', OTP_DELIVERY: 'console' }),
    ).not.toThrow();
  });

  it('refuses to boot production with console OTP delivery', () => {
    // The console adapter delivers nothing. In production that is a silent
    // total-login outage, so it must be a crash instead.
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', OTP_DELIVERY: 'console' }),
    ).toThrow(/OTP_DELIVERY/);
  });

  it('refuses to boot production with OTP delivery unset', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production' }),
    ).toThrow(/OTP_DELIVERY/);
  });

  it('requires SMS vendor settings when live delivery is selected', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', OTP_DELIVERY: 'live' }),
    ).toThrow(/OTP_SMS_ENDPOINT/);
  });

  it('accepts a fully configured production environment', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_DELIVERY: 'live',
        OTP_SMS_ENDPOINT: 'https://sms.example/send',
        OTP_SMS_API_KEY: 'k',
      }),
    ).not.toThrow();
  });

  it('still enforces the existing rules', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
    expect(() => validateEnv({ ...base, CORS_ORIGIN: '*' })).toThrow(
      /CORS_ORIGIN/,
    );
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- config.validation`
Expected: FAIL — production + console currently passes.

- [ ] **Step 5: Extend `validateEnv`**

In `apps/flick-api/src/common/config.validation.ts`, add before `return config;`:

```ts
  const isProduction = config.NODE_ENV === 'production';
  const otpDelivery = config.OTP_DELIVERY;

  if (isProduction && otpDelivery !== 'live') {
    throw new Error(
      'OTP_DELIVERY must be "live" in production — the console adapter logs codes instead of sending them, which silently locks every user out',
    );
  }

  if (otpDelivery === 'live') {
    const missingVendor = ['OTP_SMS_ENDPOINT', 'OTP_SMS_API_KEY'].filter(
      (key) => !config[key],
    );
    if (missingVendor.length > 0) {
      throw new Error(
        `OTP_DELIVERY=live requires: ${missingVendor.join(', ')}`,
      );
    }
  }
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/flick-api && npm test -- config.validation`
Expected: PASS (6 tests).

- [ ] **Step 7: Document the new variables**

Add to `apps/flick-api/.env.example` (create it if absent):

```
# OTP delivery: "console" (dev/CI — logs codes) or "live" (real vendors).
# Must be "live" in production; the app refuses to boot otherwise.
OTP_DELIVERY=console
# OTP_SMS_ENDPOINT=https://vendor.example/send
# OTP_SMS_API_KEY=
# OTP_SMS_SENDER=Flick
# OTP_EMAIL_ENDPOINT=https://vendor.example/email
# OTP_EMAIL_API_KEY=
# OTP_EMAIL_FROM=no-reply@flick.co.th
# Service-wide 24h OTP send ceiling (defaults to 5000).
# OTP_GLOBAL_DAILY_CAP=5000
```

- [ ] **Step 8: Full suite + lint**

Run: `cd apps/flick-api && npm run lint && npm test && npm run test:e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/flick-api/src/auth/otp/ apps/flick-api/src/common/config.validation.ts apps/flick-api/src/common/config.validation.spec.ts apps/flick-api/.env.example
git commit -m "feat(auth): select OTP delivery by config and fail closed on misconfiguration"
```

---

## Phase 4 — PaymentIntent + Gateway Port + FakeGateway

`POST /payments/checkout` becomes real. No money moves yet: no webhook exists, so no entitlement is granted.

---

### Task 18: `PaymentIntent` schema

**Files:**
- Modify: `apps/flick-api/prisma/schema.prisma` (add model + `User.paymentIntents` relation)
- Create: `apps/flick-api/prisma/migrations/<timestamp>_payment_intents/migration.sql` (generated)

**Interfaces:**
- Consumes: Task 1's migration state
- Produces: Prisma model `PaymentIntent`

`PaymentEvent` needs **no** changes — it is already correctly modeled (`gatewayEventId @unique`, `idempotencyKey @unique`, `amountSatangs Int`). `PaymentIntent` is the new *pre*-payment record; `PaymentEvent` stays the *"the gateway told us what happened"* record.

- [ ] **Step 1: Add the model**

In `apps/flick-api/prisma/schema.prisma`, add after the `Subscription` model (after line 218):

```prisma
model PaymentIntent {
  id     String @id @default(uuid())
  userId String

  // Both resolved server-side from plans.config.ts at checkout. The client
  // sends only itemType + itemId; it can never propose an amount.
  itemType      String // "SUBSCRIPTION" | "COIN_PACK"
  itemId        String // key into plans.config.ts — 'weekly' | 'starter' | ...
  amountSatangs Int
  currency      String @default("THB")

  // PENDING | SUCCEEDED | FAILED | EXPIRED. Transitions are enforced in code
  // by guarded updateMany (…where status: 'PENDING'), which is what stops a
  // late FAILED webhook from overwriting a SUCCEEDED intent.
  status String @default("PENDING")

  gateway         String
  gatewayChargeId String? @unique
  idempotencyKey  String  @unique
  expiresAt       DateTime

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([userId, status])
  @@map("payment_intents")
}
```

- [ ] **Step 2: Add the back-relation on `User`**

In the `User` model, alongside `paymentEvents` (line 68), add:

```prisma
  paymentIntents PaymentIntent[]
```

- [ ] **Step 3: Generate the migration**

Run: `cd apps/flick-api && npm run migrate:dev -- --name payment_intents`
Expected: new migration folder; client regenerated.

- [ ] **Step 4: Verify**

Run: `cd apps/flick-api && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/prisma/
git commit -m "feat(payments): add PaymentIntent model"
```

---

### Task 19: Server-side catalog resolution

**Files:**
- Create: `apps/flick-api/src/payments/catalog.ts`
- Test: `apps/flick-api/src/payments/catalog.spec.ts`

**Interfaces:**
- Consumes: `SUBSCRIPTION_PLANS`, `COIN_PACKS`, `PLAN_DURATIONS_MS`, `PaidPlanId` from `../plans/plans.config`
- Produces:
  - `type CatalogItemType = 'SUBSCRIPTION' | 'COIN_PACK'`
  - `interface ResolvedCatalogItem { itemType; itemId; amountSatangs; description; coins?; durationMs? }`
  - `resolveCatalogItem(itemType: CatalogItemType, itemId: string): ResolvedCatalogItem` — throws `BadRequestException` on anything unknown

**This is the single most important file in the payments subsystem.** It is the only place a price is turned into a number, and the only place baht becomes satangs. `plans.config.ts:6-15` documents the revenue bug that happened last time a client was trusted with plan ids: ฿49 bought 30 days instead of 7.

- [ ] **Step 1: Write the failing test**

Create `apps/flick-api/src/payments/catalog.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { resolveCatalogItem } from './catalog';
import { COIN_PACKS, PLAN_DURATIONS_MS, SUBSCRIPTION_PLANS } from '../plans/plans.config';

describe('resolveCatalogItem', () => {
  it('prices the weekly plan in satangs, not baht', () => {
    const item = resolveCatalogItem('SUBSCRIPTION', 'weekly');
    expect(item.amountSatangs).toBe(4900); // ฿49
    expect(item.durationMs).toBe(PLAN_DURATIONS_MS.weekly);
  });

  it('prices the monthly plan with its own duration', () => {
    const item = resolveCatalogItem('SUBSCRIPTION', 'monthly');
    expect(item.amountSatangs).toBe(14900);
    // The bug plans.config.ts documents: weekly must never get the monthly
    // duration.
    expect(item.durationMs).toBe(PLAN_DURATIONS_MS.monthly);
    expect(item.durationMs).not.toBe(PLAN_DURATIONS_MS.weekly);
  });

  it('resolves every paid plan and coin pack in the config', () => {
    for (const id of Object.keys(PLAN_DURATIONS_MS)) {
      expect(() => resolveCatalogItem('SUBSCRIPTION', id)).not.toThrow();
    }
    for (const pack of COIN_PACKS) {
      const item = resolveCatalogItem('COIN_PACK', pack.id);
      expect(item.coins).toBe(pack.coins);
      expect(item.amountSatangs).toBe(pack.price * 100);
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

  it('rejects unknown ids and cross-type ids', () => {
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'nope')).toThrow(
      BadRequestException,
    );
    expect(() => resolveCatalogItem('COIN_PACK', 'nope')).toThrow(
      BadRequestException,
    );
    // A coin pack id must not resolve as a subscription.
    expect(() => resolveCatalogItem('SUBSCRIPTION', 'starter')).toThrow(
      BadRequestException,
    );
    expect(() => resolveCatalogItem('COIN_PACK', 'weekly')).toThrow(
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- catalog`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 3: Write the implementation**

Create `apps/flick-api/src/payments/catalog.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import {
  COIN_PACKS,
  PLAN_DURATIONS_MS,
  SUBSCRIPTION_PLANS,
  type PaidPlanId,
} from '../plans/plans.config';

export type CatalogItemType = 'SUBSCRIPTION' | 'COIN_PACK';

export interface ResolvedCatalogItem {
  itemType: CatalogItemType;
  itemId: string;
  /** Smallest currency unit. Never a float, never client-supplied. */
  amountSatangs: number;
  description: string;
  /** COIN_PACK only — how many coins to credit on success. */
  coins?: number;
  /** SUBSCRIPTION only — how long the entitlement lasts. */
  durationMs?: number;
}

/** plans.config.ts stores baht; the ledger stores satangs. */
const SATANGS_PER_BAHT = 100;

const UNKNOWN_PLAN = 'ไม่พบแพ็กเกจนี้ (Unknown plan)';
const UNKNOWN_PACK = 'ไม่พบแพ็กเหรียญนี้ (Unknown coin pack)';

/**
 * Turns a client-supplied item identifier into a server-owned price. The
 * client never sends an amount, so there is nothing to validate against —
 * only an id to look up, and an exception if it is not in the catalog.
 */
export function resolveCatalogItem(
  itemType: CatalogItemType,
  itemId: string,
): ResolvedCatalogItem {
  if (itemType === 'SUBSCRIPTION') {
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

  const pack = COIN_PACKS.find((candidate) => candidate.id === itemId);
  if (!pack || pack.price <= 0) throw new BadRequestException(UNKNOWN_PACK);

  return {
    itemType,
    itemId,
    amountSatangs: pack.price * SATANGS_PER_BAHT,
    description: `Flick ${pack.name} (${pack.coins} coins)`,
    coins: pack.coins,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/flick-api && npm test -- catalog`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/src/payments/catalog.ts apps/flick-api/src/payments/catalog.spec.ts
git commit -m "feat(payments): resolve item prices server-side from plans.config"
```

---

### Task 20: Gateway port + `FakeGateway`

**Files:**
- Create: `apps/flick-api/src/payments/payment-gateway.port.ts`
- Create: `apps/flick-api/src/payments/adapters/fake-gateway.adapter.ts`
- Test: `apps/flick-api/src/payments/adapters/fake-gateway.adapter.spec.ts`

**Interfaces:**
- Consumes: `ConfigService`
- Produces:
  - `PAYMENT_GATEWAY_PORT` — DI token
  - `interface CheckoutRequest { intentId; amountSatangs; currency; description; returnUrl }`
  - `interface CheckoutResult { checkoutUrl: string; gatewayChargeId: string | null }`
  - `type GatewayEventStatus = 'SUCCEEDED' | 'FAILED' | 'PENDING'`
  - `interface GatewayEvent { gatewayEventId; eventType; status; intentId; gatewayChargeId; amountSatangs; currency }`
  - `interface PaymentGatewayPort { name; createCheckout; verifyWebhook; parseWebhookEvent }`
  - `class FakeGatewayAdapter implements PaymentGatewayPort` plus `signPayload(body: Buffer): string` for tests

> **Two deliberate refinements of the spec's interface, both preserving its invariants:**
> 1. `verifyWebhookSignature` becomes **async** `verifyWebhook(...): Promise<boolean>`. Omise does not HMAC-sign webhooks the way Stripe does; the documented verification is to re-fetch the event from the Omise API by id. A synchronous signature cannot express that. Async covers both mechanisms.
> 2. `CheckoutResult.gatewayChargeId` is **nullable**. This resolves the spec's open TBD ("store `gatewayRef`? or defer to webhook"): store it when the gateway returns one at create-charge time, otherwise leave it null and let the webhook fill it in. Neither path is load-bearing for linking, because the intent id is echoed through gateway metadata.

- [ ] **Step 1: Write the port**

Create `apps/flick-api/src/payments/payment-gateway.port.ts`:

```ts
export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');

export interface CheckoutRequest {
  /** Our PaymentIntent id. MUST be round-tripped through gateway metadata so
   *  the webhook can be tied back to the intent it belongs to. */
  intentId: string;
  amountSatangs: number;
  currency: string;
  description: string;
  returnUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  /** Null when the gateway only reveals its charge id in the webhook. */
  gatewayChargeId: string | null;
}

export type GatewayEventStatus = 'SUCCEEDED' | 'FAILED' | 'PENDING';

export interface GatewayEvent {
  /** The gateway's own event id. Its uniqueness is our whole idempotency story. */
  gatewayEventId: string;
  eventType: string;
  status: GatewayEventStatus;
  intentId: string;
  gatewayChargeId: string;
  amountSatangs: number;
  currency: string;
}

export interface PaymentGatewayPort {
  /** Stored on PaymentIntent.gateway and matched against the :gateway route param. */
  readonly name: string;

  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Async on purpose: some gateways verify by HMAC over the raw body, others
   * (Omise) by re-fetching the event from their API. `rawBody` is the exact
   * bytes received — never a re-serialized parse.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean>;

  /** Called only after verifyWebhook resolved true. Throws on malformed input. */
  parseWebhookEvent(rawBody: Buffer): GatewayEvent;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/flick-api/src/payments/adapters/fake-gateway.adapter.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { FakeGatewayAdapter } from './fake-gateway.adapter';

describe('FakeGatewayAdapter', () => {
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'PAYMENT_WEBHOOK_SECRET' ? 'test-secret' : fallback,
  } as unknown as ConfigService;

  let gateway: FakeGatewayAdapter;

  beforeEach(() => {
    gateway = new FakeGatewayAdapter(config);
  });

  const webhookBody = (overrides = {}) =>
    Buffer.from(
      JSON.stringify({
        id: 'evt_1',
        type: 'charge.complete',
        status: 'SUCCEEDED',
        intentId: 'pi_1',
        chargeId: 'chrg_1',
        amountSatangs: 4900,
        currency: 'THB',
        ...overrides,
      }),
    );

  it('returns a checkout url carrying the intent id', async () => {
    const result = await gateway.createCheckout({
      intentId: 'pi_1',
      amountSatangs: 4900,
      currency: 'THB',
      description: 'Flick Weekly VIP',
      returnUrl: 'https://flick.test/return',
    });

    expect(result.checkoutUrl).toContain('pi_1');
  });

  it('accepts a correctly signed body', async () => {
    const body = webhookBody();
    const signature = gateway.signPayload(body);

    await expect(
      gateway.verifyWebhook(body, { 'x-flick-signature': signature }),
    ).resolves.toBe(true);
  });

  it('rejects a forged signature', async () => {
    await expect(
      gateway.verifyWebhook(webhookBody(), {
        'x-flick-signature': 'deadbeef',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a body altered after signing', async () => {
    // The exact attack the raw-body rule exists to stop: sign a ฿49 charge,
    // then swap the amount.
    const signature = gateway.signPayload(webhookBody());

    await expect(
      gateway.verifyWebhook(webhookBody({ amountSatangs: 1 }), {
        'x-flick-signature': signature,
      }),
    ).resolves.toBe(false);
  });

  it('rejects a missing signature header', async () => {
    await expect(gateway.verifyWebhook(webhookBody(), {})).resolves.toBe(false);
  });

  it('parses a verified body into a GatewayEvent', () => {
    expect(gateway.parseWebhookEvent(webhookBody())).toEqual({
      gatewayEventId: 'evt_1',
      eventType: 'charge.complete',
      status: 'SUCCEEDED',
      intentId: 'pi_1',
      gatewayChargeId: 'chrg_1',
      amountSatangs: 4900,
      currency: 'THB',
    });
  });

  it('throws on a malformed body', () => {
    expect(() => gateway.parseWebhookEvent(Buffer.from('not json'))).toThrow();
    expect(() =>
      gateway.parseWebhookEvent(Buffer.from(JSON.stringify({ id: 'evt_1' }))),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- fake-gateway`
Expected: FAIL — `Cannot find module './fake-gateway.adapter'`.

- [ ] **Step 4: Write the adapter**

Create `apps/flick-api/src/payments/adapters/fake-gateway.adapter.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CheckoutRequest,
  CheckoutResult,
  GatewayEvent,
  GatewayEventStatus,
  PaymentGatewayPort,
} from '../payment-gateway.port';

const SIGNATURE_HEADER = 'x-flick-signature';
const VALID_STATUSES: GatewayEventStatus[] = ['SUCCEEDED', 'FAILED', 'PENDING'];

/**
 * Deterministic gateway for tests and local development. It implements the
 * real HMAC-over-raw-body verification so the webhook path under test is the
 * same code path production uses — only the vendor differs.
 */
@Injectable()
export class FakeGatewayAdapter implements PaymentGatewayPort {
  readonly name = 'fake';
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('PAYMENT_WEBHOOK_SECRET', 'dev-secret');
  }

  createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    return Promise.resolve({
      checkoutUrl: `https://fake-gateway.local/checkout/${request.intentId}?return=${encodeURIComponent(request.returnUrl)}`,
      // This fake reveals its charge id only in the webhook, exercising the
      // nullable branch of CheckoutResult.
      gatewayChargeId: null,
    });
  }

  /** Test helper: produce the signature a real sender would attach. */
  signPayload(rawBody: Buffer): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean> {
    const provided = headers[SIGNATURE_HEADER];
    if (typeof provided !== 'string') return Promise.resolve(false);

    const expected = Buffer.from(this.signPayload(rawBody), 'utf8');
    const actual = Buffer.from(provided, 'utf8');
    if (expected.length !== actual.length) return Promise.resolve(false);
    return Promise.resolve(timingSafeEqual(expected, actual));
  }

  parseWebhookEvent(rawBody: Buffer): GatewayEvent {
    const parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;

    const event: GatewayEvent = {
      gatewayEventId: String(parsed.id ?? ''),
      eventType: String(parsed.type ?? ''),
      status: parsed.status as GatewayEventStatus,
      intentId: String(parsed.intentId ?? ''),
      gatewayChargeId: String(parsed.chargeId ?? ''),
      amountSatangs: Number(parsed.amountSatangs),
      currency: String(parsed.currency ?? ''),
    };

    // A malformed event must fail loudly here rather than reach the
    // fulfillment transaction with NaN or empty ids.
    if (
      !event.gatewayEventId ||
      !event.intentId ||
      !VALID_STATUSES.includes(event.status) ||
      !Number.isInteger(event.amountSatangs)
    ) {
      throw new Error('Malformed gateway event');
    }
    return event;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/flick-api && npm test -- fake-gateway`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api/src/payments/payment-gateway.port.ts apps/flick-api/src/payments/adapters/
git commit -m "feat(payments): add gateway port and signed fake gateway"
```

---

### Task 21: `POST /payments/checkout`

**Files:**
- Create: `apps/flick-api/src/payments/dto/create-checkout.dto.ts`
- Create: `apps/flick-api/src/payments/payments.service.ts`
- Create: `apps/flick-api/src/payments/payments.controller.ts`
- Create: `apps/flick-api/src/payments/payments.module.ts`
- Test: `apps/flick-api/src/payments/payments.service.spec.ts`
- Modify: `apps/flick-api/src/app.module.ts`

**Interfaces:**
- Consumes: `resolveCatalogItem` (Task 19), `PAYMENT_GATEWAY_PORT`/`PaymentGatewayPort` (Task 20), `PrismaService`, `ConfigService`
- Produces:
  - `CreateCheckoutDto { itemType: CatalogItemType; itemId: string }`
  - `PaymentsService.createCheckout(userId: string, dto: CreateCheckoutDto): Promise<{ checkoutUrl: string; intentId: string }>`
  - `POST /payments/checkout` (authenticated)

`POST /subscriptions` keeps throwing `ServiceUnavailableException` and is **not** touched — browser-initiated activation stays impossible.

- [ ] **Step 1: Write the DTO**

Create `apps/flick-api/src/payments/dto/create-checkout.dto.ts`:

```ts
import { IsIn, IsString, MaxLength } from 'class-validator';
import type { CatalogItemType } from '../catalog';

/**
 * Note what is NOT here: no amount, no price, no currency, no duration. The
 * global ValidationPipe runs with forbidNonWhitelisted, so a request carrying
 * any of those is rejected outright rather than silently ignored.
 */
export class CreateCheckoutDto {
  @IsIn(['SUBSCRIPTION', 'COIN_PACK'])
  itemType: CatalogItemType;

  @IsString()
  @MaxLength(64)
  itemId: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/flick-api/src/payments/payments.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_GATEWAY_PORT } from './payment-gateway.port';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PaymentsService.createCheckout', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let gateway: {
    name: string;
    createCheckout: jest.Mock;
    verifyWebhook: jest.Mock;
    parseWebhookEvent: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    gateway = {
      name: 'fake',
      createCheckout: jest.fn().mockResolvedValue({
        checkoutUrl: 'https://gw.test/c/pi_1',
        gatewayChargeId: null,
      }),
      verifyWebhook: jest.fn(),
      parseWebhookEvent: jest.fn(),
    };
    prisma.paymentIntent.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'pi_1', ...args.data }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_GATEWAY_PORT, useValue: gateway },
        { provide: WalletService, useValue: { credit: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d ?? 'https://flick.test' },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('stores the server-resolved price, ignoring anything the client might want', async () => {
    await service.createCheckout('u1', {
      itemType: 'SUBSCRIPTION',
      itemId: 'weekly',
    });

    const created = prisma.paymentIntent.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.amountSatangs).toBe(4900);
    expect(created.data.status).toBe('PENDING');
    expect(created.data.userId).toBe('u1');
    expect(created.data.idempotencyKey).toEqual(expect.any(String));
    expect(created.data.expiresAt).toEqual(expect.any(Date));
  });

  it('passes the intent id to the gateway so the webhook can be tied back', async () => {
    await service.createCheckout('u1', {
      itemType: 'COIN_PACK',
      itemId: 'starter',
    });

    const request = gateway.createCheckout.mock.calls[0][0] as {
      intentId: string;
      amountSatangs: number;
    };
    expect(request.intentId).toBe('pi_1');
    expect(request.amountSatangs).toBe(3500); // ฿35
  });

  it('returns the checkout url and intent id', async () => {
    await expect(
      service.createCheckout('u1', { itemType: 'SUBSCRIPTION', itemId: 'weekly' }),
    ).resolves.toEqual({
      checkoutUrl: 'https://gw.test/c/pi_1',
      intentId: 'pi_1',
    });
  });

  it('rejects an unknown item before creating any intent', async () => {
    await expect(
      service.createCheckout('u1', { itemType: 'SUBSCRIPTION', itemId: 'nope' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.paymentIntent.create).not.toHaveBeenCalled();
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it('records a charge id when the gateway returns one at checkout', async () => {
    gateway.createCheckout.mockResolvedValue({
      checkoutUrl: 'https://gw.test/c/pi_1',
      gatewayChargeId: 'chrg_1',
    });

    await service.createCheckout('u1', {
      itemType: 'SUBSCRIPTION',
      itemId: 'weekly',
    });

    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'pi_1' },
      data: { gatewayChargeId: 'chrg_1' },
    });
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- payments.service`
Expected: FAIL — `Cannot find module './payments.service'`.

- [ ] **Step 4: Write the service**

Create `apps/flick-api/src/payments/payments.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { resolveCatalogItem } from './catalog';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from './payment-gateway.port';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

/** An unpaid intent stops being honourable after this long. */
const INTENT_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    private readonly wallet: WalletService,
    config: ConfigService,
  ) {
    this.appBaseUrl = config.get<string>('APP_BASE_URL', 'http://localhost:3000');
  }

  /**
   * Creates a PENDING intent at a server-resolved price and hands back a
   * gateway checkout URL. Nothing is granted here — the browser returning from
   * that URL proves nothing, so only the webhook can fulfil this intent.
   */
  async createCheckout(
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<{ checkoutUrl: string; intentId: string }> {
    // Throws before anything is written if the id is not in the catalog.
    const item = resolveCatalogItem(dto.itemType, dto.itemId);

    const intent = await this.prisma.paymentIntent.create({
      data: {
        userId,
        itemType: item.itemType,
        itemId: item.itemId,
        amountSatangs: item.amountSatangs,
        currency: 'THB',
        status: 'PENDING',
        gateway: this.gateway.name,
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });

    const result = await this.gateway.createCheckout({
      intentId: intent.id,
      amountSatangs: intent.amountSatangs,
      currency: intent.currency,
      description: item.description,
      // A "we're processing your payment" screen, not a success screen: the
      // webhook may not have landed by the time the browser gets back.
      returnUrl: `${this.appBaseUrl}/subscribe/processing?intent=${intent.id}`,
    });

    // Some gateways only reveal their charge id in the webhook; storing it
    // here when offered just gives us a second way to correlate.
    if (result.gatewayChargeId) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { gatewayChargeId: result.gatewayChargeId },
      });
    }

    this.logger.log(
      `Checkout created: intent=${intent.id} item=${item.itemType}:${item.itemId} amount=${item.amountSatangs}`,
    );
    return { checkoutUrl: result.checkoutUrl, intentId: intent.id };
  }
}
```

- [ ] **Step 5: Write the controller and module**

Create `apps/flick-api/src/payments/payments.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('checkout')
  createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    // userId comes from the validated JWT, never from the body.
    return this.paymentsService.createCheckout(user.id, dto);
  }
}
```

Create `apps/flick-api/src/payments/payments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from './payment-gateway.port';
import { FakeGatewayAdapter } from './adapters/fake-gateway.adapter';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [ConfigModule, WalletModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY_PORT,
      inject: [ConfigService],
      // Phase 6 adds the Omise branch here.
      useFactory: (config: ConfigService): PaymentGatewayPort =>
        new FakeGatewayAdapter(config),
    },
  ],
})
export class PaymentsModule {}
```

Confirm `WalletModule` exports `WalletService`; if it does not, add it to that module's `exports`.

- [ ] **Step 6: Register the module**

In `apps/flick-api/src/app.module.ts`, import `PaymentsModule` and add it to `imports` after `SubscriptionsModule`.

- [ ] **Step 7: Run the tests**

Run: `cd apps/flick-api && npm test -- payments.service`
Expected: PASS (5 tests).

- [ ] **Step 8: Full suite + lint**

Run: `cd apps/flick-api && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/flick-api/src/payments/ apps/flick-api/src/app.module.ts
git commit -m "feat(payments): add checkout endpoint with server-resolved pricing"
```

---

## Phase 5 — Webhook + Transactional Entitlement

This is where money becomes access. Every invariant in the Global Constraints section is enforced here.

---

### Task 22: `WalletService.credit()` accepts an existing transaction

**Files:**
- Modify: `apps/flick-api/src/wallet/wallet.service.ts:114-155`
- Test: `apps/flick-api/src/wallet/wallet.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: nothing new
- Produces: `credit(userId, amount, type, description, paymentEventId?, tx?): Promise<number>` — when `tx` is supplied, the write joins the caller's transaction instead of opening its own
- Unchanged: `spend()`, `unlockEpisode()`, `hasUnlocked()`, `getWallet()`, and the `lockUserRow` row-lock pattern

`credit()` currently has **no callers** (verified by grep), so this signature change breaks nothing. The webhook is its first consumer, and it needs the coin ledger write to commit or roll back with `PaymentEvent` and `PaymentIntent` — a crash between them must not be possible.

- [ ] **Step 1: Write the failing test**

Add to `apps/flick-api/src/wallet/wallet.service.spec.ts`:

```ts
  it('joins a caller-supplied transaction instead of opening its own', async () => {
    // The webhook drives one transaction across PaymentEvent, PaymentIntent
    // and the coin ledger. If credit() opened its own, a crash could leave
    // coins credited for a payment we never recorded.
    const outerTx = createPrismaMock();
    outerTx.$queryRaw.mockResolvedValue([{ coinBalance: 10 }]);

    const balance = await service.credit(
      'u1',
      100,
      TransactionType.PURCHASED,
      'purchase:coinpack:starter',
      'pe1',
      outerTx as unknown as Prisma.TransactionClient,
    );

    expect(balance).toBe(110);
    expect(outerTx.userCoin.create).toHaveBeenCalled();
    // The service must NOT have started a transaction of its own.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still opens its own transaction when none is supplied', async () => {
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 10 }]);

    await service.credit(
      'u1',
      100,
      TransactionType.PURCHASED,
      'purchase:coinpack:starter',
    );

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('links the ledger row to its payment event', async () => {
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 0 }]);

    await service.credit(
      'u1',
      320,
      TransactionType.PURCHASED,
      'purchase:coinpack:popular',
      'pe1',
    );

    expect(tx.userCoin.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 320,
          balanceAfter: 320,
          paymentEventId: 'pe1',
        }),
      }),
    );
  });

  it('rejects a non-positive credit before touching the ledger', async () => {
    await expect(
      service.credit('u1', 0, TransactionType.PURCHASED, 'bad'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.userCoin.create).not.toHaveBeenCalled();
  });
```

Add `Prisma` and `TransactionType` to the `@prisma/client` import in that spec file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- wallet.service`
Expected: FAIL — the supplied `tx` is ignored, so `prisma.$transaction` is still called.

- [ ] **Step 3: Refactor `credit()`**

In `apps/flick-api/src/wallet/wallet.service.ts`, replace the `credit` method (lines 114-155) with a private worker plus a thin public wrapper:

```ts
  /**
   * The actual credit write. Assumes it is already inside a transaction —
   * `lockUserRow` only serializes concurrent writers while that transaction
   * is open.
   */
  private async creditWithin(
    tx: Tx,
    userId: string,
    amount: number,
    type: TransactionType,
    description: string,
    paymentEventId?: string,
  ): Promise<number> {
    const user = await this.lockUserRow(tx, userId);
    if (!user) throw new NotFoundException();

    const balanceAfter = user.coinBalance + amount;
    await tx.userCoin.create({
      data: {
        userId,
        transactionType: type,
        amount,
        balanceAfter,
        description,
        ...(paymentEventId ? { paymentEventId } : {}),
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { coinBalance: balanceAfter },
    });
    return balanceAfter;
  }

  /**
   * Credits `amount` coins to `userId` (EARNED, PURCHASED, REFUNDED).
   *
   * Pass `tx` to join an existing transaction. The payment webhook does this
   * so the PaymentEvent row, the PaymentIntent status change, and this ledger
   * write all commit together or not at all — a process crash between them
   * would otherwise hand out coins for a payment we never recorded, or record
   * a payment that never paid out.
   *
   * Uses the same row-lock pattern as `spend()`: a precomputed `balanceAfter`
   * literal is not safe against concurrent credits without it.
   */
  async credit(
    userId: string,
    amount: number,
    type: TransactionType,
    description: string,
    paymentEventId?: string,
    tx?: Tx,
  ): Promise<number> {
    if (amount <= 0) {
      throw new BadRequestException('จำนวนเหรียญไม่ถูกต้อง');
    }

    if (tx) {
      return this.creditWithin(tx, userId, amount, type, description, paymentEventId);
    }
    return this.prisma.$transaction((ownTx) =>
      this.creditWithin(ownTx, userId, amount, type, description, paymentEventId),
    );
  }
```

Export the `Tx` type so `PaymentsService` can name it — change line 19 to:

```ts
export type Tx = Prisma.TransactionClient;
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/flick-api && npm test -- wallet.service`
Expected: PASS — including every pre-existing `spend`/`unlockEpisode` test, which must be untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/src/wallet/
git commit -m "refactor(wallet): let credit() join a caller-supplied transaction"
```

---

### Task 23: Preserve the raw request body

**Files:**
- Modify: `apps/flick-api/src/main.ts:11`

**Interfaces:**
- Consumes: nothing
- Produces: `req.rawBody` (a `Buffer`) available on every request, typed via `RawBodyRequest<Request>` from `@nestjs/common`

> **Refinement of the spec's approach, same guarantee.** The spec called for registering `express.raw({ type: 'application/json' })` on the webhook route. Nest 11 offers `NestFactory.create(AppModule, { rawBody: true })`, which stashes the original bytes via the body parser's `verify` hook — the parsed body still works everywhere else, and `req.rawBody` is the exact received bytes. This is the same guarantee with far less ordering risk: route-specific `express.raw` has to be registered before Nest's global parser, and getting that order wrong produces a webhook that passes every manual test and rejects 100% of real traffic.

- [ ] **Step 1: Enable raw body capture**

In `apps/flick-api/src/main.ts`, change line 11:

```ts
  // rawBody keeps the ORIGINAL request bytes on req.rawBody alongside the
  // parsed body. The payment webhook's HMAC is computed over exactly what the
  // gateway sent; verifying a re-serialized JSON.stringify of the parsed body
  // would mismatch on key order and whitespace and reject every real webhook.
  const app = await NestFactory.create(AppModule, { rawBody: true });
```

- [ ] **Step 2: Verify the app still boots and the suite passes**

Run: `cd apps/flick-api && npx tsc --noEmit -p tsconfig.json && npm test && npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/flick-api/src/main.ts
git commit -m "feat(payments): preserve raw request bodies for webhook signature checks"
```

---

### Task 24: Webhook endpoint + transactional fulfillment

**Files:**
- Modify: `apps/flick-api/src/payments/payments.service.ts`
- Modify: `apps/flick-api/src/payments/payments.controller.ts`
- Test: `apps/flick-api/src/payments/payments.service.spec.ts` (add a `describe`)

**Interfaces:**
- Consumes: `PaymentGatewayPort` (Task 20), `WalletService.credit` with `tx` (Task 22), `req.rawBody` (Task 23), `resolveCatalogItem` (Task 19)
- Produces:
  - `PaymentsService.handleWebhook(gatewayName: string, rawBody: Buffer, headers): Promise<{ received: true }>`
  - `POST /payments/webhook/:gateway` — public, throttle-exempt

**The ordering here is load-bearing. Do not rearrange it:**

1. **Verify the signature first**, over `rawBody`, before parsing. An unverified body is attacker-controlled data.
2. **Read the intent, then insert the `PaymentEvent`.** The insert must happen before any state change, because its unique constraint on `gatewayEventId` is what makes a replayed webhook a no-op. The `P2002` is caught *outside* the transaction — a constraint violation aborts the whole transaction, so nothing partial can survive.
3. **Guard every transition with `updateMany({ where: { status: 'PENDING' } })`.** `count === 0` means someone else already moved it. This is what makes it impossible for a late `FAILED` event to overwrite a `SUCCEEDED` intent, and impossible for two concurrent `SUCCEEDED` deliveries to both grant entitlement.
4. **Compare the amount** the gateway reports against the amount we recorded. A mismatch means something is wrong upstream; do not fulfil.
5. **Return 200 for everything the gateway cannot fix by retrying** — unknown intent, already-handled, expired. A non-200 makes the gateway retry-storm a state that will never change. Only a bad signature or a malformed body earns a 4xx.

- [ ] **Step 1: Write the failing test**

Append to `apps/flick-api/src/payments/payments.service.spec.ts`:

```ts
describe('PaymentsService.handleWebhook', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let wallet: { credit: jest.Mock };
  let gateway: {
    name: string;
    createCheckout: jest.Mock;
    verifyWebhook: jest.Mock;
    parseWebhookEvent: jest.Mock;
  };

  const rawBody = Buffer.from('{"id":"evt_1"}');
  const headers = { 'x-flick-signature': 'sig' };

  const succeededEvent = (overrides = {}) => ({
    gatewayEventId: 'evt_1',
    eventType: 'charge.complete',
    status: 'SUCCEEDED' as const,
    intentId: 'pi_1',
    gatewayChargeId: 'chrg_1',
    amountSatangs: 4900,
    currency: 'THB',
    ...overrides,
  });

  const pendingIntent = (overrides = {}) => ({
    id: 'pi_1',
    userId: 'u1',
    itemType: 'SUBSCRIPTION',
    itemId: 'weekly',
    amountSatangs: 4900,
    currency: 'THB',
    status: 'PENDING',
    gateway: 'fake',
    gatewayChargeId: null,
    idempotencyKey: 'idem-1',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    wallet = { credit: jest.fn().mockResolvedValue(100) };
    gateway = {
      name: 'fake',
      createCheckout: jest.fn(),
      verifyWebhook: jest.fn().mockResolvedValue(true),
      parseWebhookEvent: jest.fn().mockReturnValue(succeededEvent()),
    };
    prisma.paymentEvent.create.mockResolvedValue({ id: 'pe_1' });
    prisma.paymentIntent.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_GATEWAY_PORT, useValue: gateway },
        { provide: WalletService, useValue: wallet },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d ?? 'https://flick.test' },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  const run = () => service.handleWebhook('fake', rawBody, headers);

  it('verifies the signature over the raw body before parsing', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    await run();

    expect(gateway.verifyWebhook).toHaveBeenCalledWith(rawBody, headers);
    // Order matters: parsing attacker-controlled bytes before verifying them
    // is the bug this assertion exists to catch.
    expect(gateway.verifyWebhook.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.parseWebhookEvent.mock.invocationCallOrder[0],
    );
  });

  it('rejects a forged signature without any database write', async () => {
    gateway.verifyWebhook.mockResolvedValue(false);

    await expect(run()).rejects.toThrow(BadRequestException);
    expect(gateway.parseWebhookEvent).not.toHaveBeenCalled();
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a webhook addressed to a different gateway', async () => {
    await expect(
      service.handleWebhook('someone-else', rawBody, headers),
    ).rejects.toThrow(BadRequestException);
    expect(gateway.verifyWebhook).not.toHaveBeenCalled();
  });

  it('grants a subscription with autoRenew false and the right duration', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());

    await expect(run()).resolves.toEqual({ received: true });

    const created = prisma.subscription.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.userId).toBe('u1');
    expect(created.data.planType).toBe('weekly');
    expect(created.data.status).toBe('ACTIVE');
    // One-time purchase model: nothing auto-charges later.
    expect(created.data.autoRenew).toBe(false);

    const start = created.data.startDate as Date;
    const end = created.data.endDate as Date;
    expect(end.getTime() - start.getTime()).toBe(PLAN_DURATIONS_MS.weekly);
  });

  it('credits coins inside the same transaction as the payment records', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ itemType: 'COIN_PACK', itemId: 'starter', amountSatangs: 3500 }),
    );
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ amountSatangs: 3500 }),
    );

    await run();

    expect(wallet.credit).toHaveBeenCalledWith(
      'u1',
      100, // starter pack coins
      TransactionType.PURCHASED,
      expect.stringContaining('starter'),
      'pe_1',
      // The 6th argument is the transaction client — its presence is the
      // whole point of the Task 22 refactor.
      expect.anything(),
    );
  });

  it('treats a duplicate delivery as a no-op and still answers 200', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.paymentEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('never promotes an already-FAILED intent to SUCCEEDED', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ status: 'FAILED' }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('ignores a webhook that arrives after the intent expired', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('refuses to fulfil when the reported amount does not match the intent', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ amountSatangs: 1 }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('grants nothing when the guarded status update matches no rows', async () => {
    // A concurrent delivery won the race and already fulfilled this intent.
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.paymentIntent.updateMany.mockResolvedValue({ count: 0 });

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('records a FAILED event without granting anything', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ status: 'FAILED' }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pi_1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('answers 200 for an unknown intent rather than making the gateway retry', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(null);

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('stores only allowlisted metadata, never the raw provider payload', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    await run();

    const created = prisma.paymentEvent.create.mock.calls[0][0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(Object.keys(created.data.metadata).sort()).toEqual([
      'gatewayChargeId',
      'intentId',
    ]);
  });
});
```

Add to the imports at the top of that spec file:

```ts
import { Prisma, TransactionType } from '@prisma/client';
import { PLAN_DURATIONS_MS } from '../plans/plans.config';
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- payments.service`
Expected: FAIL — `service.handleWebhook is not a function`.

- [ ] **Step 3: Implement `handleWebhook`**

Add to `apps/flick-api/src/payments/payments.service.ts`. Extend the imports:

```ts
import { BadRequestException } from '@nestjs/common';
import { Prisma, SubscriptionStatus, TransactionType } from '@prisma/client';
import type { Tx } from '../wallet/wallet.service';
import type { GatewayEvent } from './payment-gateway.port';
import { resolveCatalogItem, type CatalogItemType } from './catalog';
```

Then add these methods to the class:

```ts
  /**
   * The ONLY path that grants paid access. A browser returning from the
   * gateway proves nothing — anyone can request that URL — so entitlement
   * hangs entirely off a signature-verified server-to-server callback.
   */
  async handleWebhook(
    gatewayName: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true }> {
    if (gatewayName !== this.gateway.name) {
      throw new BadRequestException('Unknown gateway');
    }

    // Verify BEFORE parsing: until this returns true, rawBody is nothing but
    // attacker-controlled bytes.
    const verified = await this.gateway.verifyWebhook(rawBody, headers);
    if (!verified) {
      this.logger.warn(
        `Rejected ${gatewayName} webhook with an invalid signature`,
      );
      throw new BadRequestException('Invalid signature');
    }

    let event: GatewayEvent;
    try {
      event = this.gateway.parseWebhookEvent(rawBody);
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    await this.fulfill(event);

    // Always 200 once the event is durably handled — including the "nothing to
    // do" cases. A non-200 makes the gateway retry a state that will never
    // change.
    return { received: true };
  }

  private async fulfill(event: GatewayEvent): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const intent = await tx.paymentIntent.findUnique({
          where: { id: event.intentId },
        });
        if (!intent) {
          // Nothing to attribute the event to — PaymentEvent.userId is
          // required, so there is no row we could even write.
          this.logger.warn(
            `Webhook ${event.gatewayEventId} references unknown intent ${event.intentId}`,
          );
          return;
        }

        // THE idempotency gate. gatewayEventId is @unique, so a replayed
        // delivery throws P2002 here and aborts the whole transaction before
        // touching any state. No read-then-write check — that would race.
        const paymentEvent = await tx.paymentEvent.create({
          data: {
            userId: intent.userId,
            eventType: event.eventType,
            gateway: this.gateway.name,
            gatewayEventId: event.gatewayEventId,
            // Derived from the event's own natural key so that a SECOND,
            // different event for the same intent (pending → succeeded, or a
            // later refund) does not collide on this unique column.
            idempotencyKey: `${this.gateway.name}:${event.gatewayEventId}`,
            status: event.status,
            amountSatangs: event.amountSatangs,
            currency: event.currency,
            // Allowlisted fields only. Never the raw provider payload — it can
            // carry cardholder details we have no business storing.
            metadata: {
              intentId: event.intentId,
              gatewayChargeId: event.gatewayChargeId,
            },
          },
        });

        if (event.status === 'PENDING') return; // recorded; nothing to grant

        if (intent.status !== 'PENDING') {
          this.logger.log(
            `Intent ${intent.id} is already ${intent.status}; ignoring ${event.eventType}`,
          );
          return;
        }

        if (intent.expiresAt.getTime() < Date.now()) {
          await tx.paymentIntent.updateMany({
            where: { id: intent.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
          this.logger.warn(`Intent ${intent.id} expired before its webhook landed`);
          return;
        }

        if (
          event.amountSatangs !== intent.amountSatangs ||
          event.currency !== intent.currency
        ) {
          this.logger.error(
            `Amount mismatch on intent ${intent.id}: gateway said ${event.amountSatangs} ${event.currency}, we recorded ${intent.amountSatangs} ${intent.currency}`,
          );
          return;
        }

        if (event.status === 'FAILED') {
          await tx.paymentIntent.updateMany({
            where: { id: intent.id, status: 'PENDING' },
            data: { status: 'FAILED', gatewayChargeId: event.gatewayChargeId },
          });
          return;
        }

        // Guarded transition. If a concurrent delivery already claimed this
        // intent, count is 0 and we grant nothing — this is what stops a
        // double subscription or a double coin credit.
        const claimed = await tx.paymentIntent.updateMany({
          where: { id: intent.id, status: 'PENDING' },
          data: { status: 'SUCCEEDED', gatewayChargeId: event.gatewayChargeId },
        });
        if (claimed.count === 0) return;

        await this.grantEntitlement(tx, intent, paymentEvent.id);
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Replay. The transaction rolled back, so nothing partial survives.
        this.logger.log(
          `Duplicate webhook ${event.gatewayEventId} ignored (already recorded)`,
        );
        return;
      }
      throw err;
    }
  }

  /** Runs inside the caller's transaction — never opens one of its own. */
  private async grantEntitlement(
    tx: Tx,
    intent: {
      id: string;
      userId: string;
      itemType: string;
      itemId: string;
    },
    paymentEventId: string,
  ): Promise<void> {
    // Re-resolved server-side rather than trusted from the stored row, so the
    // price/duration source of truth stays plans.config.ts.
    const item = resolveCatalogItem(
      intent.itemType as CatalogItemType,
      intent.itemId,
    );

    if (item.itemType === 'SUBSCRIPTION') {
      const startDate = new Date();
      await tx.subscription.create({
        data: {
          userId: intent.userId,
          planType: intent.itemId,
          status: SubscriptionStatus.ACTIVE,
          // One-time purchases only: no stored card, nothing to auto-charge.
          autoRenew: false,
          startDate,
          endDate: new Date(startDate.getTime() + (item.durationMs ?? 0)),
          paymentMethod: this.gateway.name,
        },
      });
      this.logger.log(`Subscription granted for intent ${intent.id}`);
      return;
    }

    // `tx` passed through so the coin ledger commits with the payment records.
    await this.wallet.credit(
      intent.userId,
      item.coins ?? 0,
      TransactionType.PURCHASED,
      `purchase:coinpack:${intent.itemId}`,
      paymentEventId,
      tx,
    );
    this.logger.log(`Coins credited for intent ${intent.id}`);
  }
```

- [ ] **Step 4: Add the controller route**

In `apps/flick-api/src/payments/payments.controller.ts`, add the imports and handler:

```ts
import { Param, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
```

```ts
  /**
   * Server-to-server callback from the gateway. @Public because a gateway has
   * no session; @SkipThrottle because throttling a gateway's retries turns a
   * transient blip into lost payments. Authentication here IS the signature.
   */
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('webhook/:gateway')
  webhook(
    @Param('gateway') gateway: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!req.rawBody) {
      // Only possible if main.ts's rawBody option was removed.
      throw new BadRequestException('Raw body unavailable');
    }
    return this.paymentsService.handleWebhook(gateway, req.rawBody, req.headers);
  }
```

Add `BadRequestException` to the `@nestjs/common` import.

- [ ] **Step 5: Run the tests**

Run: `cd apps/flick-api && npm test -- payments.service`
Expected: PASS (18 tests — 5 from Task 21, 13 here).

- [ ] **Step 6: Full suite + lint**

Run: `cd apps/flick-api && npm run lint && npm test && npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-api/src/payments/
git commit -m "feat(payments): fulfil verified webhooks in one idempotent transaction"
```

---

### Task 25: Webhook e2e — the whole money path, end to end

**Files:**
- Create: `apps/flick-api/test/payments.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /payments/checkout` (Task 21), `POST /payments/webhook/:gateway` (Task 24), `FakeGatewayAdapter.signPayload` (Task 20), the OTP login helper (Task 13)
- Produces: proof that checkout → signed webhook → entitlement works against a real HTTP stack and a real database

The unit tests mock Prisma. This one does not: it is the only place the `@@unique` constraint, the `$transaction` rollback, and the guarded `updateMany` are exercised against Postgres, which is where they actually live.

- [ ] **Step 1: Write the e2e spec**

Create `apps/flick-api/test/payments.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import { PAYMENT_GATEWAY_PORT } from './../src/payments/payment-gateway.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';
import type { FakeGatewayAdapter } from './../src/payments/adapters/fake-gateway.adapter';

describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let gateway: FakeGatewayAdapter;
  let cookies: string[];

  const seededPhone = '+66800000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // rawBody must be enabled here too, exactly as main.ts does it — without
    // it req.rawBody is undefined and every webhook 400s.
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    await app.init();

    gateway = app.get<FakeGatewayAdapter>(PAYMENT_GATEWAY_PORT, {
      strict: false,
    });
    const delivery = app.get<ConsoleOtpDeliveryAdapter>(OTP_DELIVERY_PORT, {
      strict: false,
    });

    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: seededPhone })
      .expect(200);
    const verified = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        destination: seededPhone,
        ref: (requested.body as { ref: string }).ref,
        code: delivery.lastCodeFor(seededPhone),
      })
      .expect(200);
    cookies = verified.headers['set-cookie'] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
  });

  /** Creates an intent and returns its id. */
  async function checkout(itemType: string, itemId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', cookies)
      .send({ itemType, itemId })
      .expect(200);
    return (res.body as { intentId: string }).intentId;
  }

  /** Posts a webhook signed the way the gateway would sign it. */
  function postWebhook(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload));
    return request(app.getHttpServer())
      .post('/payments/webhook/fake')
      .set('Content-Type', 'application/json')
      .set('x-flick-signature', gateway.signPayload(body))
      .send(body);
  }

  const chargeEvent = (intentId: string, overrides = {}) => ({
    id: `evt_${intentId}`,
    type: 'charge.complete',
    status: 'SUCCEEDED',
    intentId,
    chargeId: `chrg_${intentId}`,
    amountSatangs: 4900,
    currency: 'THB',
    ...overrides,
  });

  it('requires a session to start a checkout', () => {
    return request(app.getHttpServer())
      .post('/payments/checkout')
      .send({ itemType: 'SUBSCRIPTION', itemId: 'weekly' })
      .expect(401);
  });

  it('rejects an unknown item id', () => {
    return request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', cookies)
      .send({ itemType: 'SUBSCRIPTION', itemId: 'vip-weekly' })
      .expect(400);
  });

  it('refuses a request that tries to supply its own price', () => {
    // forbidNonWhitelisted turns a smuggled amount into a 400 rather than a
    // silently-ignored field.
    return request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', cookies)
      .send({ itemType: 'SUBSCRIPTION', itemId: 'weekly', amountSatangs: 1 })
      .expect(400);
  });

  it('grants nothing until a verified webhook arrives', async () => {
    await checkout('SUBSCRIPTION', 'weekly');

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);

    // The intent exists, the browser could have "returned" — still no access.
    expect(me.body).toBeFalsy();
  });

  it('rejects a forged webhook signature', async () => {
    const intentId = await checkout('SUBSCRIPTION', 'weekly');

    await request(app.getHttpServer())
      .post('/payments/webhook/fake')
      .set('Content-Type', 'application/json')
      .set('x-flick-signature', 'deadbeef')
      .send(Buffer.from(JSON.stringify(chargeEvent(intentId))))
      .expect(400);

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(me.body).toBeFalsy();
  });

  it('activates a subscription on a verified webhook', async () => {
    const intentId = await checkout('SUBSCRIPTION', 'weekly');
    await postWebhook(chargeEvent(intentId)).expect(200);

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);

    const subscription = me.body as { planType: string; autoRenew: boolean };
    expect(subscription.planType).toBe('weekly');
    expect(subscription.autoRenew).toBe(false);
  });

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

  it('answers 200 for a webhook referencing no known intent', () => {
    // A 4xx here would make a real gateway retry forever.
    return postWebhook(chargeEvent('pi_does_not_exist')).expect(200);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `cd apps/flick-api && npm run db:seed && npm run test:e2e`
Expected: PASS.

If the "idempotent under duplicate delivery" test fails with the balance credited twice, the `P2002` catch is in the wrong place — it must wrap the whole `$transaction`, not sit inside it.

- [ ] **Step 3: Commit**

```bash
git add apps/flick-api/test/payments.e2e-spec.ts
git commit -m "test(payments): cover checkout, signature rejection, and webhook idempotency"
```

---

## Phase 6 — Real Gateway + Checkout UI

---

### Task 26: Omise gateway adapter

**Files:**
- Create: `apps/flick-api/src/payments/adapters/omise-gateway.adapter.ts`
- Modify: `apps/flick-api/src/payments/payments.module.ts`
- Modify: `apps/flick-api/src/common/config.validation.ts`
- Test: `apps/flick-api/src/payments/adapters/omise-gateway.adapter.spec.ts`

**Interfaces:**
- Consumes: `PaymentGatewayPort` (Task 20), `ConfigService`
- Produces: `OmiseGatewayAdapter` with `name = 'omise'`, selected when `PAYMENT_GATEWAY=omise`

> **STOP AND VERIFY BEFORE WRITING THIS FILE.** Omise's webhook authentication model is **not** the HMAC-header model the fake gateway uses. Omise historically does **not** sign webhook payloads; the documented verification is to re-fetch the event from the Omise API by its id over an authenticated TLS connection and compare. That is exactly why `verifyWebhook` is async.
>
> Read the current Omise/Opn Payments API docs before implementing, and confirm:
> 1. How webhook authenticity is established today (re-fetch by event id? an HMAC header they have since added? IP allowlist?). **Implement whatever they actually document — never assume a signature header exists.**
> 2. Whether `POST /charges` returns an `authorize_uri` synchronously (it does for most sources), which determines whether `gatewayChargeId` comes back at checkout or only in the webhook.
> 3. The exact event `key` strings (`charge.complete`, `charge.create`, …) and how `status` (`successful` / `failed` / `pending`) maps onto `GatewayEventStatus`.
>
> If verification turns out to require a re-fetch, `verifyWebhook` performs that HTTP call and returns whether the fetched event matches the received body. **Do not fall back to "trust the body" if the fetch fails — return `false`.**

- [ ] **Step 1: Confirm the three questions above against live Omise documentation**

Record the answers as a comment block at the top of the adapter file so the next reader does not have to re-derive them.

- [ ] **Step 2: Write the failing test**

Create `apps/flick-api/src/payments/adapters/omise-gateway.adapter.spec.ts`. Mirror the `fake-gateway.adapter.spec.ts` structure (Task 20), covering at minimum:

- `createCheckout` posts the amount in satangs, in `THB`, with our `intentId` in Omise's `metadata` — assert the request body, with `global.fetch` spied.
- `createCheckout` returns the `authorize_uri` as `checkoutUrl`.
- `verifyWebhook` returns `false` when verification fails (bad signature, or a re-fetch that 404s / mismatches) — assert **no** exception escapes, just `false`.
- `verifyWebhook` returns `false` when the verification request itself throws (network error). Fail closed.
- `parseWebhookEvent` maps Omise's `status` strings onto `GatewayEventStatus` and pulls `intentId` back out of `metadata`.
- `parseWebhookEvent` throws when `metadata.intentId` is absent — an event we cannot attribute must not silently become `intentId: ''`.

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/flick-api && npm test -- omise-gateway`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the adapter**

Create `apps/flick-api/src/payments/adapters/omise-gateway.adapter.ts` implementing `PaymentGatewayPort`, following the verified answers from Step 1. Requirements that hold regardless of what the docs say:

- `readonly name = 'omise'`.
- Every outbound call carries `AbortSignal.timeout(...)` — a stalled gateway must not pin a request.
- Secret keys come from `ConfigService.getOrThrow` (`OMISE_SECRET_KEY`), never from a literal.
- `verifyWebhook` returns `false` on any failure path; it never throws and never returns `true` by default.
- `intentId` travels in Omise `metadata` and is read back out in `parseWebhookEvent`.
- Amounts stay integers in satangs on both legs.
- No log line contains a card token, a full charge payload, or a secret key.

- [ ] **Step 5: Add gateway selection to the module**

In `apps/flick-api/src/payments/payments.module.ts`, replace the factory body:

```ts
      useFactory: (config: ConfigService): PaymentGatewayPort => {
        const selected = config.get<string>('PAYMENT_GATEWAY', 'fake');
        if (selected === 'omise') return new OmiseGatewayAdapter(config);
        return new FakeGatewayAdapter(config);
      },
```

- [ ] **Step 6: Fail closed on a misconfigured production deploy**

In `apps/flick-api/src/common/config.validation.ts`, alongside the OTP rules from Task 17:

```ts
  if (isProduction && config.PAYMENT_GATEWAY !== 'omise') {
    throw new Error(
      'PAYMENT_GATEWAY must be a real gateway in production — the fake gateway accepts self-signed webhooks and would mint free access',
    );
  }

  if (config.PAYMENT_GATEWAY === 'omise' && !config.OMISE_SECRET_KEY) {
    throw new Error('PAYMENT_GATEWAY=omise requires OMISE_SECRET_KEY');
  }

  if (isProduction && !config.PAYMENT_WEBHOOK_SECRET) {
    throw new Error('PAYMENT_WEBHOOK_SECRET is required in production');
  }
```

Add matching cases to `config.validation.spec.ts` (created in Task 17) — production with `PAYMENT_GATEWAY=fake` must throw; a fully configured production env must not.

- [ ] **Step 7: Document the new variables**

Append to `apps/flick-api/.env.example`:

```
# Payment gateway: "fake" (dev/CI) or "omise". Must be a real gateway in
# production — the fake gateway accepts webhooks it signed itself.
PAYMENT_GATEWAY=fake
PAYMENT_WEBHOOK_SECRET=dev-secret
# OMISE_SECRET_KEY=
# Base URL the gateway sends the browser back to.
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 8: Full suite + lint**

Run: `cd apps/flick-api && npm run lint && npm test && npm run test:e2e`
Expected: PASS. The e2e suite still runs on the fake gateway — nothing in CI reaches Omise.

- [ ] **Step 9: Commit**

```bash
git add apps/flick-api/src/payments/ apps/flick-api/src/common/ apps/flick-api/.env.example
git commit -m "feat(payments): add Omise gateway adapter and production config guards"
```

---

### Task 27: Checkout UI + processing screen

**Files:**
- Modify: `apps/flick-app/src/types/api.ts`
- Modify: `apps/flick-app/src/types/index.ts`
- Create: `apps/flick-app/src/features/payments/api.ts`
- Modify: `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`
- Create: `apps/flick-app/src/app/subscribe/processing/page.tsx`

**Interfaces:**
- Consumes: `POST /payments/checkout` (Task 21), `GET /subscriptions/me` (existing)
- Produces:
  - `CheckoutResponse { checkoutUrl: string; intentId: string }` in the API contract
  - `startCheckout(itemType, itemId): Promise<CheckoutResult>`
  - a processing screen that polls until the webhook lands

**Read `apps/flick-app/node_modules/next/dist/docs/` before writing these files.** The processing page reads a search param and polls on an interval — both are areas where this Next version may differ from what you expect.

**The UI rule this task exists to enforce:** returning from the gateway means "we are waiting to hear from the payment provider", **not** "you have been charged" and never "you have access". The webhook may land before, during, or well after the redirect. The screen must poll and be honest about it.

- [ ] **Step 1: Extend the API contract**

In `apps/flick-app/src/types/index.ts`:

```ts
/** Body of POST /payments/checkout. */
export interface CheckoutResponse {
  checkoutUrl: string;
  intentId: string;
}
```

In `apps/flick-app/src/types/api.ts`, add `'/payments/checkout'` to `ApiPath`, add the branch `Path extends '/payments/checkout' ? CheckoutResponse :` to `ApiResponse`, and add a decoder case:

```ts
  if (path === '/payments/checkout') {
    const checkout = requireRecord(value, 'checkout');
    if (
      typeof checkout.checkoutUrl !== 'string' ||
      typeof checkout.intentId !== 'string'
    ) {
      throw new TypeError('Invalid checkout response');
    }
    return checkout as ApiResponse<Path>;
  }
```

- [ ] **Step 2: Write the payments client**

Create `apps/flick-app/src/features/payments/api.ts`:

```ts
'use client';
import { ApiError, apiFetch } from '@/lib/apiClient';

export type CheckoutResult =
  | { success: true; checkoutUrl: string; intentId: string }
  | { success: false; error: string };

/**
 * Starts a purchase. Note what is not sent: no price. The server resolves the
 * amount from its own catalog, so the client cannot propose one.
 */
export async function startCheckout(
  itemType: 'SUBSCRIPTION' | 'COIN_PACK',
  itemId: string,
): Promise<CheckoutResult> {
  try {
    const data = await apiFetch('/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ itemType, itemId }),
    });
    return { success: true, checkoutUrl: data.checkoutUrl, intentId: data.intentId };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof ApiError
          ? err.message
          : 'ไม่สามารถเริ่มการชำระเงินได้ กรุณาลองใหม่',
    };
  }
}
```

- [ ] **Step 3: Wire up `SubscribeClient`**

In `apps/flick-app/src/app/subscribe/SubscribeClient.tsx`:

- Delete the `UNAVAILABLE_MSG` banner and the "เร็ว ๆ นี้" badges and disabled buttons (lines 7-10, 39-42, 59-63, 84-90).
- Add `const [busyItem, setBusyItem] = useState<string | null>(null)` and an error state.
- Give each paid plan button and each coin pack an `onClick` that calls:

```tsx
  const handleBuy = async (
    itemType: 'SUBSCRIPTION' | 'COIN_PACK',
    itemId: string,
  ) => {
    setBusyItem(itemId);
    setError('');
    const result = await startCheckout(itemType, itemId);
    if (!result.success) {
      setBusyItem(null);
      setError(result.error);
      return;
    }
    // Full navigation, not router.push — the checkout page is the gateway's,
    // not ours.
    window.location.href = result.checkoutUrl;
  };
```

- Keep the free plan's existing `router.push('/home')` behaviour untouched.
- Render `error` in the same `role="alert"` style the login page uses.

- [ ] **Step 4: Add the processing screen**

Create `apps/flick-app/src/app/subscribe/processing/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiClient';
import { Icon } from '@/components/ui/Icon';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

export default function PaymentProcessingPage() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        // The webhook is the only thing that grants access, and it may land
        // before, during, or after this redirect. Polling our OWN API is the
        // only honest way to know — the gateway's return URL proves nothing.
        const subscription = await apiFetch('/subscriptions/me');
        if (!cancelled && subscription) {
          router.replace('/home');
          router.refresh();
          return;
        }
      } catch {
        // A transient failure is not a failed payment — keep polling.
      }

      if (cancelled) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    let timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
      {timedOut ? (
        <>
          <Icon name="infoCircle" size={28} className="text-fg-mute" />
          <h1 className="text-title font-display">การชำระเงินอาจใช้เวลาสักครู่</h1>
          {/* Deliberately neither "paid" nor "failed": we genuinely do not
              know yet, and claiming either would be a lie. */}
          <p className="max-w-sm text-sm text-fg-dim">
            เราจะเปิดใช้งานให้อัตโนมัติเมื่อได้รับการยืนยันจากผู้ให้บริการชำระเงิน
          </p>
          <Link href="/home" className="mt-2 font-medium text-brand-ink">
            กลับหน้าแรก
          </Link>
        </>
      ) : (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-brand-ink" />
          <h1 className="text-title font-display">กำลังตรวจสอบการชำระเงิน...</h1>
          <p className="text-sm text-fg-dim">กรุณาอย่าปิดหน้านี้</p>
        </>
      )}
    </div>
  );
}
```

For a coin-pack purchase the same screen applies, but poll `GET /wallet` for a balance change instead. Pass the item type through the return URL (`&type=COIN_PACK`) and read it with `useSearchParams` to pick which endpoint to poll — check `node_modules/next/dist/docs/` for this version's `useSearchParams` requirements (it typically needs a `<Suspense>` boundary).

- [ ] **Step 5: Type-check, lint, test, build**

Run: `cd apps/flick-app && npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Run the stack with `npm run dev` from the repo root, with `PAYMENT_GATEWAY=fake` and `OTP_DELIVERY=console`:

1. Log in with the seeded phone `+66800000001`, reading the code from the API log.
2. Click a paid plan. Confirm the browser navigates to the fake gateway URL.
3. From a terminal, POST a signed webhook for that intent id (reuse the helper shape from `payments.e2e-spec.ts`).
4. Confirm `/subscribe/processing?intent=...` flips to `/home` and `/subscriptions/me` returns the subscription.

- [ ] **Step 7: Commit**

```bash
git add apps/flick-app/src/
git commit -m "feat(payments): enable checkout and add a payment-processing screen"
```

---

## Spec Coverage

Every section of `docs/superpowers/specs/2026-08-23-otp-auth-payments-design.md` maps to a task:

| Spec section | Tasks |
|---|---|
| Part 1 — `User` nullability, `OtpChannel`/`OtpPurpose`, `OtpChallenge` | 1 |
| Part 1 — `PaymentIntent` | 18 |
| Part 2 — delivery abstraction + adapters | 5, 16, 17 |
| Part 2 — endpoints, uniform response shape | 10, 12 |
| Part 2 — E.164 normalization | 2 |
| Part 2 — request flow (steps 1-6), rate limits | 7 |
| Part 2 — verify flow (steps 1-6), JWT issuance | 8, 11 |
| Part 2 — "why each control exists" table | 2, 4, 7, 8 |
| Part 3 — gateway abstraction, `FakeGateway` | 20 |
| Part 3 — checkout | 19, 21 |
| Part 3 — webhook, raw body, transactional fulfillment | 23, 24 |
| Part 3 — `WalletService.credit()` refactor | 22 |
| Part 4 — frontend auth collapse | 14, 15 |
| Part 4 — checkout UI + processing poll | 27 |
| Part 5 — OTP tests | 4, 7, 8, 13 |
| Part 5 — payment tests | 19, 20, 21, 24, 25 |
| Part 6 — phasing | Phases 1-6 as ordered |
| Open item — existing password users | Phase 2 pre-check |

**Spec TBDs resolved during planning:**

| TBD | Resolution | Task |
|---|---|---|
| Production SMS vendor unchosen | `HttpOtpDeliveryAdapter` targets a generic HTTP JSON vendor configured entirely by env, so picking a vendor changes one file | 16 |
| Store `gatewayRef` at checkout, or defer to webhook? | Both: `CheckoutResult.gatewayChargeId` is nullable — stored when offered, filled by the webhook otherwise. Correlation never depends on it, because the intent id round-trips through gateway metadata | 20, 21 |

**Two deliberate refinements of the spec, each preserving its invariant:**

1. `verifyWebhookSignature` → async `verifyWebhook`. Omise does not HMAC-sign webhooks the way the spec's sketch assumes; its documented verification is a re-fetch by event id, which a synchronous boolean cannot express. The invariant — *authenticity established before the body is trusted* — is unchanged. (Tasks 20, 26)
2. Raw body via `NestFactory.create(AppModule, { rawBody: true })` rather than route-scoped `express.raw`. Same guarantee (HMAC over exactly the received bytes) with no parser-ordering footgun. (Task 23)

---

## Deliberately Out of Scope

Named here so they are decisions, not oversights:

- **Refunds and chargebacks.** The spec's one-time-purchase model has no refund flow. A `charge.refund` webhook would be *recorded* as a `PaymentEvent` and grant nothing, which is correct but not a refund feature. Revoking an already-granted subscription or clawing back spent coins needs its own design.
- **Auto-renewal, stored cards, billing jobs.** Explicitly excluded by the spec's locked-in decisions. `autoRenew` is forced `false` everywhere.
- **Sweeping expired rows.** Nothing deletes stale `OtpChallenge` rows or bulk-transitions abandoned `PENDING` intents to `EXPIRED`. Both are handled correctly *on read* (expiry is checked at verify and at fulfillment), so this is housekeeping, not correctness. `@@index([expiresAt])` on `OtpChallenge` exists so a future sweep is cheap.
- **`OtpPurpose.VERIFY_EMAIL`.** Present in the enum per the spec; no code path uses it. Adding email verification is a later feature.
- **`Device.refreshTokenHash` / session revocation.** The spec's prologue notes it sits unused. Still unused after these six phases.
- **Rotating the JWT on OTP verify vs. issuing a fresh one.** Unchanged from today's behaviour: a new token is signed per login.

---

## Execution Order Note

Phases 1-2 and Phases 4-5 are each internally sequential. Phase 3 (real delivery adapters) and Phase 4 (payment intents) touch disjoint files and can run in parallel if two workers are available. Phase 6 depends on Phase 5.

Do **not** ship Phase 2 to production before Phase 3: Phase 2 removes password login while OTP delivery is still console-only. Between those phases, production has no working login path. Either ship 1-3 together, or keep the old endpoints behind a flag — the plan assumes the former, which is why Task 17 makes a console-delivery production boot a hard crash.
