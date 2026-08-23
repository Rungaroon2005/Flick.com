# OTP authentication + secure payments

> Replaces email/password login with phone-first OTP, and turns the deliberately-disabled
> `POST /subscriptions` into a real, idempotent, gateway-agnostic payment flow. Two
> subsystems, one spec, phased so each phase ships and tests independently.
>
> **Verified against:** NestJS 11 · Prisma 7.9 (driver adapter `@prisma/adapter-pg`) ·
> `apps/flick-api` · 23 Aug 2026

---

## Prologue: what is actually there today

**Auth.** `auth.service.ts` is email + bcrypt password, full stop. `User.passwordHash`
is `String` (required — not nullable). `User.phone` and `User.isVerified` exist in the
schema (`schema.prisma:48-70`) and are accepted by `RegisterDto` but never used for
anything: no code reads `isVerified`, no code sends a code to `phone`. A single
`access_token` JWT cookie is issued on register/login (`auth.controller.ts:37-45`); there
is no second factor, no session list, no revocation — despite `Device.refreshTokenHash`
existing in the schema specifically "to revoke sessions" and sitting unused.

**Payments.** `POST /subscriptions` throws `ServiceUnavailableException` on purpose
(`subscriptions.controller.ts:22-30`) — access must only ever be activated by a verified
gateway callback, and until one exists it fails closed. `plans.config.ts:6-15` documents
the exact bug this guards against: a legacy client sent a plan id that silently fell
through to the wrong duration map, so ฿49 bought 30 days instead of 7 — the reason prices
now live in one server-side source of truth. `PaymentEvent` is already modeled for a
real integration: `gatewayEventId @unique`, `idempotencyKey @unique`,
`amountSatangs Int` (no floats), `gateway String` (comment names Stripe/Omise),
`currency` defaults `THB`. `WalletService.credit()` (`wallet.service.ts:123-155`) already
implements the correct `SELECT ... FOR UPDATE` row-locked ledger write and takes an optional
`paymentEventId` — its doc comment says outright it's waiting on "a payment gateway
integration that is out of scope for this task."

**What must survive unchanged:** `WalletService.spend()` / `unlockEpisode()`'s row-lock
pattern, `SubscriptionsService`'s ACTIVE-or-CANCELED-until-`endDate` entitlement logic,
and `plans.config.ts` as the sole price source.

---

## Decisions locked in during brainstorming

| Question | Decision |
|---|---|
| OTP's role in auth | **Passwordless.** OTP *is* login; no password path survives. |
| Delivery channel | **SMS primary, verified-email fallback** (not free-text email at request time). |
| Payment gateway | **Abstracted behind a port**, shaped on Omise's real redirect/webhook semantics (the vendor named in the existing schema comment), driven by a fake adapter in tests. |
| Renewal model | **One-time purchases only.** No stored cards, no auto-charge, no billing job. A plan simply expires at `endDate`; the user buys again. `autoRenew` is forced `false`. |
| Existing password users | **Removed, not migrated** — `0_init` is the only migration, so this is pre-launch. If real users exist by implementation time, this line item is revisited before Phase 2 ships. |

---

## Part 1 — Schema changes

```prisma
model User {
  passwordHash String?              // was String — passwordless users have none
  phone        String? @unique      // now the primary identity, stored E.164 (+66...)
  // isVerified, email unchanged
}

enum OtpChannel {
  SMS
  EMAIL
}

enum OtpPurpose {
  LOGIN            // covers both login and lazy-register
  VERIFY_EMAIL
}

model OtpChallenge {
  id          String     @id @default(uuid())
  channel     OtpChannel
  destination String                     // normalized E.164 or lowercased email
  codeHash    String                     // bcrypt hash of the 6-digit code — never plaintext
  ref         String                     // 4-char display ref, returned to client + included in SMS
  purpose     OtpPurpose
  attempts    Int        @default(0)
  userId      String?                    // set once the associated User is known/created
  ipAddress   String
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime   @default(now())

  @@index([destination, purpose, consumedAt])
  @@index([expiresAt])
  @@map("otp_challenges")
}

model PaymentIntent {
  id              String   @id @default(uuid())
  userId          String
  itemType        String                   // "SUBSCRIPTION" | "COIN_PACK"
  itemId          String                   // key into plans.config.ts — 'weekly' | 'starter' | ...
  amountSatangs   Int                       // resolved server-side from plans.config.ts, never client input
  currency        String   @default("THB")
  status          String   @default("PENDING") // PENDING | SUCCEEDED | FAILED | EXPIRED
  gateway          String
  gatewayChargeId  String?  @unique
  idempotencyKey   String   @unique
  expiresAt        DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @default(now()) @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([userId, status])
  @@map("payment_intents")
}
```

`PaymentEvent`, `Subscription`, `UserCoin`, `WalletService` need **no schema changes** —
`PaymentIntent` is the new "pre-payment" record; `PaymentEvent` remains the "gateway told
us what happened" record, exactly as already modeled.

---

## Part 2 — OTP engine

### Delivery abstraction

```ts
interface OtpDeliveryPort {
  send(destination: string, channel: OtpChannel, code: string): Promise<void>;
}
```

Adapters: `SmsAdapter` (production SMS vendor, TBD at implementation time),
`EmailAdapter` (existing/new mail provider), `ConsoleAdapter` (logs the code; used in
dev and CI so no test or local run needs a vendor account or incurs spend). Selection is
config-driven — same shape as `movies.module.ts:13-51`'s Redis-vs-in-memory branch on
`REDIS_URL`, this time branching on `NODE_ENV`/an explicit `OTP_DELIVERY` flag.

### Endpoints

```
POST /auth/otp/request   { destination: string, channel?: 'SMS' | 'EMAIL' }
  → 200 { ref: string, expiresIn: number }     -- ALWAYS this shape, account or not

POST /auth/otp/verify    { destination: string, ref: string, code: string }
  → 200 Set-Cookie: access_token
       { user: { id, phone, displayName }, isNewUser: boolean }
  → 401 on bad code / expired / wrong ref
  → 429 on attempts exhausted (challenge burned, must request a new one)
```

`destination` is normalized to E.164 (SMS) or lowercased (email) **before** any DB
lookup, closing the `0812345678` vs `+66812345678` two-accounts gap.

### Request flow

1. Normalize `destination`. Look up `User` by `phone` (or by verified `email` if
   `channel: 'EMAIL'` and that email is already verified on an existing account — a
   free-text email may never be used as an OTP destination for an account it isn't
   already attached to; that would be an account-takeover primitive).
2. Rate-limit checks, in order, each returning 429 with no distinguishing detail between
   "you're rate-limited" and "something else is wrong":
   - 60s cooldown since the last request to this `destination`
   - 3 requests / 15 min / `destination`
   - 10 requests / 24h / `destination`
   - global daily send cap (config value) — trips an alert, not just a 429, since this is
     the financial-DoS vector (every SMS costs money)
3. Invalidate (set `consumedAt = now()`) any prior un-consumed challenge for this
   `destination` + `purpose` — an old code must stop working the moment a new one is issued.
4. Generate a 6-digit code via `crypto.randomInt(100000, 1000000)` (never `Math.random`)
   and a 4-char `ref` (collision-tolerant — it's a display hint, not a lookup key on its
   own). Store `bcrypt.hash(code, 10)`; never persist or log the plaintext code outside
   the delivery adapter call.
5. `OtpChallenge.create()`, then `delivery.send()`. If delivery throws, the challenge row
   still exists but is unusable (no code was ever delivered) — respond 503 with Thai copy;
   the client may retry after the still-running cooldown.
6. Always return `{ ref, expiresIn }` — identical shape whether or not a `User` exists for
   this destination. This is what makes account enumeration via this endpoint impossible.

### Verify flow

Runs in one `$transaction`:

1. Look up the newest non-consumed, non-expired `OtpChallenge` for
   `(destination, purpose)`. Not found → 401, generic "invalid or expired code" message.
2. Compare `ref` (constant-time or bcrypt-timing-safe — the comparison must not leak
   which check failed first).
3. `bcrypt.compare(code, codeHash)`.
   - Match → proceed to step 4.
   - No match → `attempts += 1` (via `updateMany` guarded on `consumedAt: null` so two
     concurrent verify calls can't both increment past the same stale row); if
     `attempts >= 5`, set `consumedAt = now()` too (burns the challenge) and return 429;
     otherwise 401.
4. Consume: `updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now() } })`
   — the `where` clause is what stops two concurrent correct-code submissions from both
   succeeding (the second `updateMany` affects 0 rows once the first commits).
   `affectedRows === 0` here means "already consumed" → 401, not a crash.
5. Find-or-create `User` by `destination` inside the same transaction (`phone` for SMS,
   `email` for the verified-email path). New user gets a placeholder `displayName`
   editable later; `passwordHash` stays `null`.
6. Issue the JWT exactly as today's `login()`/`register()` do (`sub`, `email`/`phone`
   payload), set the `access_token` cookie via the controller's existing
   `setTokenCookie()`, return `{ user, isNewUser }`.

### Why each control exists

| Control | Attack it stops |
|---|---|
| `crypto.randomInt` | Predictable codes from a seeded/weak PRNG |
| bcrypt hash at rest | DB leak → offline brute force of the 10⁶ code space |
| 5-attempt cap, then burn | Online brute force |
| `updateMany` guarded on `consumedAt: null` | Double-consumption race on concurrent verify |
| 60s / 15min / 24h destination caps + global cap | SMS-bombing a victim; burning SMS budget |
| Prior challenge invalidated on new request | Stale code left live in an inbox/SMS thread |
| E.164 normalization before lookup | Same human, two accounts |
| Uniform `{ ref, expiresIn }` response | Account enumeration via the request endpoint |
| Verified-email-only fallback | Free-text email as an account-takeover vector |

---

## Part 3 — Payments

### Gateway abstraction

```ts
interface PaymentGatewayPort {
  createCheckout(intent: PaymentIntent): Promise<{ checkoutUrl: string; gatewayRef: string }>;
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean;
  parseWebhookEvent(rawBody: Buffer): GatewayEvent; // { gatewayEventId, status, chargeId, metadata }
}
```

Shaped on Omise's actual redirect-then-webhook model (hosted checkout URL out,
signed POST callback back) rather than an idealized abstraction, since Omise is the
named production candidate — grounding the interface in one real gateway is what keeps it
from needing a rewrite when that gateway is actually wired up. `FakeGateway` drives all
tests: deterministic `checkoutUrl`, a helper to synthesize a signed webhook body.

### Checkout

```
POST /payments/checkout  { itemType: 'SUBSCRIPTION' | 'COIN_PACK', itemId: string }
  → 200 { checkoutUrl: string, intentId: string }
```

1. Resolve `itemId` against `SUBSCRIPTION_PLANS` / `COIN_PACKS`
   (`plans.config.ts:23,78`) server-side. Unknown `itemId` → 400. **The request body
   never carries a price or amount field at all** — there is nothing to validate against
   because there is nothing to trust from the client.
2. `PaymentIntent.create()` with the resolved `amountSatangs`, a fresh `idempotencyKey`
   (UUID), `status: 'PENDING'`, a short `expiresAt` (e.g. 15 min).
3. `gateway.createCheckout(intent)` → store `gatewayRef`? (or defer to webhook — TBD at
   implementation time depending on what Omise's create-charge response actually returns).
4. Return `{ checkoutUrl, intentId }`; frontend redirects the browser there.

### Webhook

```
POST /payments/webhook/:gateway
```

Registered with `express.raw({ type: 'application/json' })` for this route specifically
in `main.ts` — Nest's global JSON body parser must not touch these bytes before signature
verification, or the HMAC is computed over the wrong payload and every webhook silently
fails signature checks. This is the single most common way to build this feature and have
it pass every manual test yet reject 100% of real traffic.

1. `gateway.verifyWebhookSignature(rawBody, headers)` — fail → 400, log, do not process.
2. `gateway.parseWebhookEvent(rawBody)`.
3. One `$transaction`:
   - `PaymentEvent.create({ gatewayEventId, idempotencyKey, ... })`. Unique constraint
     violation on `gatewayEventId` → this is a replay; catch it, return 200 immediately
     with no further writes. **This is the entire idempotency mechanism** — no
     separate "have I seen this before" read-then-write, which would itself race.
   - Look up the matching `PaymentIntent` (via `idempotencyKey` or `gatewayChargeId`
     depending on what the event carries). Not found / already `SUCCEEDED` /
     `expiresAt` passed → log and return 200 (never retry-storm a gateway over a state
     it can't fix by retrying).
   - On success: `PaymentIntent.status = 'SUCCEEDED'`; then, in the SAME transaction —
     - `itemType === 'SUBSCRIPTION'` → `Subscription.create()` with `autoRenew: false`,
       `endDate = now() + PLAN_DURATIONS_MS[itemId]`.
     - `itemType === 'COIN_PACK'` → `WalletService.credit()`, called with `tx` passed in
       (see refactor below) so the coin ledger write is atomic with the `PaymentEvent`
       and `PaymentIntent` writes — a crash between them must not be possible.
4. Always return 200 once the event is durably recorded — even for a "this doesn't apply"
   case in step 3 — to stop the gateway's retry loop. Only signature failures and
   transport errors should produce a non-200.

**`WalletService.credit()` refactor required:** today it opens its own
`prisma.$transaction(...)`. It needs an overload/optional param accepting an existing
`Tx` so the webhook handler can drive one transaction across `PaymentEvent`,
`PaymentIntent`, and the coin ledger. `spend()`/`unlockEpisode()` are untouched.

### Why each control exists

| Control | Attack/failure it stops |
|---|---|
| Price resolved server-side from `plans.config.ts` | The exact bug `plans.config.ts:6-15` already documents once biting the legacy client |
| Entitlement granted only by webhook, never by redirect | Browser return-URL is trivially forgeable — `subscriptions.controller.ts:24-26`'s existing principle, now implemented |
| `gatewayEventId @unique` as the idempotency gate | Gateway webhook retries double-crediting coins or double-issuing a subscription |
| Signature check on raw, unparsed body | Forged webhook calls minting free access |
| One `$transaction` across event + intent + entitlement | Partial-credit state if the process dies mid-write |
| Always-200 on "already handled" | Infinite gateway retry storms |

---

## Part 4 — Frontend impact (flick-app)

`features/auth/api.ts`'s `login`/`register` functions and `app/login/page.tsx`,
`app/register/page.tsx` collapse into a single OTP request/verify flow — two screens
(enter phone → enter code) replacing two forms (email+password ×2). `apiFetch` and the
`AuthResult`/cookie-session model (`getSession()` reads the HttpOnly cookie server-side,
per `subscribe/page.tsx:27`) are unaffected; only the request shapes change.

`app/subscribe/page.tsx` and its `SubscribeClient` gain real checkout: the "Payments are
not available yet" 503 path is replaced by a POST to `/payments/checkout` and a redirect
to `checkoutUrl`, plus a return page that polls `/subscriptions/me` (webhook may land
after the browser redirect returns — the UI must show "processing," not assume instant
success).

---

## Part 5 — Testing

Follows the repo's existing `*.spec.ts` / TDD convention. No test suite needs a vendor
account: `ConsoleAdapter` and `FakeGateway` make the whole flow — OTP request through
payment webhook — runnable in CI exactly as today.

- **OTP:** expiry, attempt exhaustion (6th attempt after 5 wrong → 429 even with the
  right code), replay of a consumed challenge, concurrent verify (two simultaneous
  correct submissions — exactly one succeeds), cooldown/rate-limit boundaries, E.164
  normalization equivalence, enumeration-safety of `/otp/request`'s response shape.
- **Payments:** signature rejection, duplicate webhook delivery (idempotency), unknown
  `itemId` rejected at checkout, expired `PaymentIntent` ignored by a late webhook,
  amount tampering impossible by construction (no amount field accepted from the client),
  coin-pack credit uses the shared-transaction path (verify via `PaymentEvent` +
  `UserCoin` + `PaymentIntent` all committed or all rolled back together).

---

## Part 6 — Phasing

Each phase ships and is independently testable; later phases depend on earlier ones but
not vice versa.

1. **OTP engine** — schema (`OtpChallenge`, `passwordHash`/`phone` nullability),
   request/verify service logic, `ConsoleAdapter`. No user-facing change yet; covered
   entirely by unit tests.
2. **Passwordless auth endpoints + frontend** — `/auth/otp/*` replaces
   `/auth/login`+`/auth/register`; old password endpoints removed; `login`/`register`
   pages rebuilt as phone→code.
3. **Real delivery adapters** — `SmsAdapter`, `EmailAdapter`, config-driven selection.
4. **`PaymentIntent` + gateway port + `FakeGateway`** — `/payments/checkout` returns a
   real (fake, in tests) `checkoutUrl`; no money moves yet.
5. **Webhook + transactional entitlement** — `WalletService.credit()` transaction-client
   refactor, `/payments/webhook/:gateway`, raw-body route registration in `main.ts`.
6. **Real gateway adapter + checkout UI** — Omise (or chosen vendor) wired in;
   `SubscribeClient` redirect + processing-state polling.

---

## Open item carried into implementation

Existing email/password users (if any exist by the time Phase 2 ships) have no defined
migration path in this spec — the decision above assumes there are none yet
(`0_init` is the only migration). If that assumption no longer holds, this must be
resolved as a blocking question before Phase 2, not discovered during it.
