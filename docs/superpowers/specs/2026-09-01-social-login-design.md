# Social Login — Design Specification

**Status:** Revision 2, 2026-09-01. Approved architecture; implementation plan at
`docs/superpowers/plans/2026-09-01-social-login.md`.
**Scope:** Google **and** Apple, in one phase.
**Supersedes:** revision 1 of this document (commits `2ad1c83`, `1c0dbbf`,
`03dce43`), which specified a server-side redirect flow. §0 records what changed
and why.
**Supersedes nothing else.** Additive to the existing passwordless OTP authentication.

---

## 0. Revision 2 — the architectural pivot

Revision 1 put the OAuth round trip in the API: `/auth/oauth/:provider/start`
issued state and redirected to the provider, and the provider redirected back to
a callback that exchanged an authorization code. **That flow is discarded.**

Revision 2 is a **client-side token flow**. The frontend runs Google One Tap and
Sign in with Apple JS, receives an `id_token` in the browser, and posts it to a
single backend endpoint that verifies it and issues a session.

What that changes:

| | Revision 1 (discarded) | Revision 2 |
|---|---|---|
| Who talks to the provider | The API, by redirect | The browser, by SDK popup |
| Endpoints | `/start`, `/:provider/callback`, `/providers` | `/nonce`, `/verify`, `/providers` |
| Apple's callback | Cross-site `form_post`, breaks `SameSite=Lax` | No callback at all |
| Apple client secret | ES256 JWT, 6-month rotation | **Not needed** |
| PKCE / `codeVerifier` | Required | Gone — there is no code exchange |
| Open-redirect surface | `safeRedirectPath` on the callback | **None** — no server redirect |
| Scope | Google, Apple deferred | Both, one phase |

Three of those are real reductions in risk and operational burden, and the Apple
client-secret rotation disappearing is the largest single win.

**What survives untouched:** the `Identity` table (§4.1), the linking rules
(§6.2), the pre-hijacking refusal (§6.3), the concurrency handling (§7), the
`User.emailVerifiedAt` invariant (§11.1), and the reaper (§9). The pivot changes
how a `ProviderProfile` is *obtained*; everything downstream of that shape is
unaffected. `IdentityResolver` is specified identically in both revisions.

**What the pivot costs, and how it is paid:** a bare "post me an `id_token`"
endpoint is replayable. Verifying `aud` stops a token minted for another
application, but a token minted for *ours* and captured anywhere it is visible —
a log line, a browser extension, an XSS — can be replayed for its full validity
to mint a session. Both SDKs accept a `nonce` that lands inside the signed
token, so §4.3 keeps a single-use server-issued nonce. Without it, `/verify` is
a replay oracle.

---

## 1. Problem

Identity is currently welded to the `User` row. `User.email` and `User.phone` are
each `@unique` and each doubles as a login handle, so a person is their row and a
row has exactly one way in. There is no way to express "this human can also
arrive via Google", and no place to record that a third party vouched for them.

This design moves to account linking: a `User` is a profile and an entitlement
holder, and one or more `Identity` records say how that person can prove they are
themselves.

---

## 2. What is already true

Stated so the plan does not budget for work that is done:

- **`passwordHash` is already nullable** (`schema.prisma:54`). Password login was
  removed entirely in `f9acb9d` / `66603d8`.
- **Sessions are already a narrow seam.** `AuthService.verifyOtp` signs
  `{ sub, email }` and `AuthController.setTokenCookie` (`auth.controller.ts:38-46`)
  sets one HttpOnly cookie. Everything downstream — `JwtStrategy`, `JwtAuthGuard`,
  `RolesGuard`, `PlaybackService`, `PaymentsService`, the frontend's
  `getSession()` — reads only that cookie.
- **Every existing `User.email` is a proven email.** The only write is
  `otp.service.ts:308`, inside `verify`, reachable only by receiving a code at
  that address. §6.3 depends on this and §11.1 preserves it.
- **The port/adapter pattern is established twice** — `PAYMENT_GATEWAY_PORT`
  (fake/Omise) and `OTP_DELIVERY_PORT`, both selected by config and both failing
  closed on misconfiguration (`config.validation.ts:27-73`). Social login is the
  third instance, not a new idiom.
- **The frontend already owns post-login navigation.** `lib/nextParam.ts`
  allowlists `next`, and `loginRedirect.ts` resolves the destination. In
  revision 2 the server never redirects, so this needs no server-side twin.

---

## 3. Decision record

| # | Decision | Rationale |
|---|---|---|
| 1 | **Client-side token flow.** The browser obtains the `id_token`; the API only verifies it. | §0. Removes Apple's `form_post`/`SameSite` collision, its client-secret rotation, PKCE, and the server redirect. |
| 2 | **One verification endpoint, `POST /auth/oauth/verify`,** for every provider. | The provider name is a field in the body, resolved to an adapter. A third provider adds an adapter and an enum value, nothing else. |
| 3 | **Provider tokens are not stored.** No `accessToken`, `refreshToken` or `expiresAt` columns. | They have no job after verification. Persisting them creates secret material at rest needing encryption and rotation, and widens what a breach yields. |
| 4 | **We verify the `id_token`; we do not exchange Apple's authorization code.** | The `id_token` is signed by Apple and carries everything login needs. Exchanging the code would reintroduce the ES256 client-secret JWT and its 6-month rotation for no gain, since we store no provider tokens (decision 3). §8.1. |
| 5 | **Auth lives in the Nest API,** not in Next.js and not in a managed IdP. | The API's JWT cookie is already the authority for entitlement and payments. A second session source would have to be reconciled with it on every server component. |
| 6 | **Auto-link only on a provider-verified email AND a locally-verified email.** | §6.2. The first blocks account takeover; the second blocks pre-hijacking. |
| 7 | **A server-issued, single-use nonce is required.** | §0. Without it `/verify` accepts a replayed `id_token` for its full lifetime. |
| 8 | **Google and Apple ship together.** | The verification path is now so thin that the second adapter is a small increment on the first, and both SDKs are frontend work in the same screen. |
| 9 | **Expired nonces are reaped on a schedule,** together with expired `OtpChallenge` rows. | §9. Both grow without bound; `OtpChallenge` has an unused `@@index([expiresAt])` already waiting for a reaper. |
| 10 | **`OtpChallenge` retention is 7 days.** | Long enough for debugging and abuse mitigation, short enough to keep the PDPA footprint of the stored `ipAddress` small. Floored at 24h by the rate limiter — §9. |
| 11 | **Pruning uses `@nestjs/schedule`.** | Runs predictably regardless of traffic; the opportunistic alternative stops exactly when traffic stops. |

---

## 4. Schema

### 4.1 `Identity` — unchanged from revision 1

```prisma
enum IdentityProvider {
  GOOGLE
  APPLE
  // LINE, FACEBOOK, GITHUB … added here; no other schema change required.
}

model Identity {
  id       String           @id @default(uuid())
  userId   String
  provider IdentityProvider

  /// The provider's stable, immutable subject id (OIDC `sub`). NEVER the email:
  /// providers let users change their email, and Apple's may be a per-app relay.
  providerAccountId String

  /// What the provider asserted AT LINK TIME, kept for audit. Not a source of
  /// truth for login — User.email is.
  email         String?
  emailVerified Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// The login key, and the race guard: concurrent first verifications collide
  /// here rather than creating two users. See §7.
  @@unique([provider, providerAccountId])
  /// One identity per provider per user; stops a retry accumulating duplicates.
  @@unique([userId, provider])
  @@index([userId])
  @@map("identities")
}
```

### 4.2 `User` changes — unchanged from revision 1

```prisma
model User {
  // … unchanged …

  /// Set once ANY channel has proven control of User.email — OTP delivery, or a
  /// provider asserting email_verified. Distinct from `isVerified`, which means
  /// "proved control of their login destination", whatever that was.
  emailVerifiedAt DateTime?

  identities Identity[]

  // … unchanged …
}
```

### 4.3 `OAuthNonce` — replaces revision 1's `OAuthState`

Revision 1's table carried `codeVerifier` and `redirectPath` for a redirect flow
that no longer exists. What remains is the replay guard.

```prisma
model OAuthNonce {
  id       String           @id @default(uuid())
  /// Random, single-use. Handed to the SDK, echoed inside the signed id_token.
  nonce    String           @unique
  provider IdentityProvider

  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  consumedAt DateTime?

  @@index([expiresAt])
  @@map("oauth_nonces")
}
```

Single-use via a `consumedAt` guard, expiry checked at read time, DB-backed so
the check cannot disagree with what was issued — the reasoning already documented
at `otp.service.ts:273-275`.

**Why the nonce must be server-issued.** A nonce the client invents proves
nothing: the server cannot tell a fresh one from one an attacker reused, so the
replay window reopens. Only a value the server minted and can burn exactly once
closes it.

### 4.4 Migration properties

Additive: two tables, one enum, one nullable column. One data step, in the same
migration:

> **Backfill.** `UPDATE users SET email_verified_at = created_at WHERE email IS NOT NULL`.
> Every existing email was proven by OTP (§2), so this states an existing fact
> rather than asserting a new one. Without it, every current email user hits the
> §6.3 refusal on their first social sign-in.

No downtime. Rollback drops the two tables and the column.

---

## 5. Provider abstraction

The port is now smaller than revision 1's: no authorization URL to build, no code
to exchange. One method.

```
OAuthProviderPort
  id: IdentityProvider
  verifyIdToken(idToken: string, expectedNonce: string): Promise<ProviderProfile>

ProviderProfile        ← the ONLY shape IdentityResolver ever sees
  providerAccountId: string      // OIDC sub
  email: string | null
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
```

A registry maps `IdentityProvider → OAuthProviderPort`, populated from config so
an unconfigured provider is **absent** rather than half-working.

`verifyIdToken` must, for every provider, check: signature against the provider's
JWKS, `iss`, `aud` equal to our own client id, `exp`, and `nonce` equal to
`expectedNonce`. A token that is merely well-signed but issued for another
application is not a login.

**Adding a provider later** is one enum value, one adapter, one config block, one
adapter test file, and one button. The resolver, controller and schema are
untouched.

**Display name is not taken from the token for Apple.** See §8.3 — it arrives
beside the token, once, and the caller passes it in.

---

## 6. Verification logic

### 6.1 Flow

```
POST /auth/oauth/verify  { provider, idToken, nonce, displayName? }
│
├─ 0. adapter ← registry[provider]        not configured ──▶ 404
│
├─ 0a. Consume nonce — single-use UPDATE guarded on consumedAt IS NULL
│      unknown / expired / wrong provider / already used ──▶ 400
│
├─ 0b. profile ← adapter.verifyIdToken(idToken, nonce)
│      JWKS signature, iss, aud, exp, nonce   any failure ──▶ 401
│      caller-supplied displayName fills profile.displayName ONLY if the token
│      carried none (§8.3)
│
├─ 1. identity ← Identity.findUnique([provider, profile.providerAccountId])
│     ├─ FOUND ──▶ user.deletedAt ? 401 : ISSUE SESSION   [returning user]
│     └─ NOT FOUND ──▶ continue
│
├─ 2. profile.email is null OR profile.emailVerified is false
│     ──▶ CREATE user (email = null) + identity, one transaction  [new user]
│
├─ 3. existing ← User.findFirst({ email: profile.email, deletedAt: null })
│     ├─ NOT FOUND ──▶ CREATE user (email, emailVerifiedAt = now) + identity,
│     │                one transaction                           [new user]
│     └─ FOUND ──▶ continue to 4
│
├─ 4. existing.emailVerifiedAt IS NULL
│     ──▶ REFUSE. 409. Log at ERROR — should be unreachable (§6.3)
│
└─ 5. AUTO-LINK: CREATE identity → existing.id, one transaction   [linked]
```

Steps 1-5 are identical to revision 1. Only steps 0-0b changed.

### 6.2 The linking rule

| Provider `email_verified` | Local user with that email | Local `emailVerifiedAt` | Action |
|---|---|---|---|
| no email at all | — | — | New user, `email = null` |
| `false` | any | any | **Never link.** New user, `email = null` |
| `true` | none | — | New user, email set + verified |
| `true` | exists | set | **Auto-link** |
| `true` | exists | null | **Refuse** (§6.3) |

Row 2 carries the design's safety. Auto-linking an unverified provider email is
the classic takeover: an attacker registers `victim@gmail.com` at any provider
that does not verify addresses, signs in, and is handed the victim's account,
subscription and history. **Apple sends `email_verified` as the string `"true"`,
not a boolean** — a truthiness check passes for `"false"` too, so adapters must
parse it explicitly and hand the resolver a real boolean.

### 6.3 Row 5, and why its copy is a compromise

Row 5 defends the pre-hijacking attack: an attacker creates a local account
claiming an email they do not control; the victim later signs in with Google;
auto-linking would log the victim into the attacker's account.

**After the §4.4 backfill this branch should be unreachable.** Every email in the
database is OTP-proven, and §11.1 keeps that invariant. It is defence in depth
against a future code path that sets `User.email` without proof.

The approved copy tells the user to sign in with OTP and then link:

> **Thai (shipped):** `มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์`
> **English (reference):** An account with this email exists. Please log in using your usual method (OTP) to verify your identity, then link this social account from your profile settings.

Right for the benign case — a user who genuinely owns both. **Wrong for the
attack case**: there the local account is the attacker's, the victim cannot sign
into it, and the message sends them in a circle. Accepted, because the
alternative is handing the account over, and because the branch should never
fire. Two requirements follow:

1. **Log every occurrence at ERROR** with the user id and provider. A hit means
   an invariant broke and needs investigation, not a support macro.
2. The copy must not imply the account is *theirs* — it says an account exists,
   never "your account". Keep that distinction.

On enumeration: this reveals that a Flick account exists for an email, to a
caller who has already proven to the provider that they control that mailbox. The
bar is controlling the mailbox, so it is not the open oracle the OTP flow avoids
(`otp.service.ts:56-68`), and it is bounded to emails the caller already owns.

### 6.4 Session issuance

Identical to OTP verify, deliberately:

```
ISSUE SESSION(user)
  token ← jwtService.signAsync({ sub: user.id, email: user.email })
  setTokenCookie(res, token)        // reuse auth.controller.ts:38-46 verbatim
  return { success: true, user: {...}, isNewUser }   ← token NOT in the body
```

Same cookie name, flags and max-age; no new session concept. The response shape
mirrors `AuthController.verifyOtp`, which strips `access_token` from the body
before returning (`auth.controller.ts:74-76`) — the token goes in the HttpOnly
cookie and nowhere a script can read it.

Because this is a same-site XHR rather than a redirect, `SameSite=Lax` is not in
play and the frontend navigates itself afterwards using its existing `safeNext`.

### 6.5 Endpoints

| Method | Route | Guard | Purpose |
|---|---|---|---|
| `GET` | `/auth/oauth/providers` | `@Public()` | Which providers are configured, for the login UI |
| `POST` | `/auth/oauth/nonce` | `@Public()`, throttled | Issue a single-use nonce for the SDK |
| `POST` | `/auth/oauth/verify` | `@Public()`, throttled | Verify an `id_token`, issue a session |

`/verify` authenticates by the provider's signature over the token, exactly as
the payment webhook authenticates by its HMAC (`payments.controller.ts:35-41`).

---

## 7. Concurrency — unchanged from revision 1

Two verifications can arrive concurrently for one `providerAccountId` — a
double-clicked button, or a user with two tabs.

**A transaction alone does not prevent the duplicate.** Under PostgreSQL's READ
COMMITTED both read "no identity" at step 1 and both insert. Atomicity is not
mutual exclusion. `@@unique([provider, providerAccountId])` is what serializes
them: one insert wins, the other raises `P2002`.

```
try:
    within $transaction(tx):
        create user (if needed)      ← same tx
        create identity              ← same tx, may raise P2002
        return user
except P2002 on (provider, providerAccountId):
    # Not an error. A concurrent verification for the same account won.
    identity ← Identity.findUnique([provider, providerAccountId])   # now exists
    return identity.user            # ISSUE SESSION normally
```

- User and identity creation in **one** `$transaction`, so a failure after the
  user insert cannot leave an account with no way to sign in.
- The `P2002` catch is narrowed to the identity constraint via `meta.target`. A
  blanket catch would swallow unrelated unique violations — the exact defect
  found in `PaymentsService` on 2026-09-01 and repaired by
  `2026-09-01-security-hardening.md` Task 3. Do not reintroduce it.

Note that each verification consumes its own nonce, so two *sequential* clicks
each need a fresh nonce; the frontend requests one per attempt.

---

## 8. Apple specifics

Far shorter than revision 1's §8: the client-side flow removes most of it.

**8.1 No client secret.** We verify the `id_token` and never exchange the code
(decision 4), so there is no ES256 JWT to mint from a `.p8` key and no 6-month
rotation to schedule. Config needs only `APPLE_CLIENT_ID` — the Services ID,
which is also the `aud` claim we check.

**8.2 No callback.** Sign in with Apple JS returns the token to the browser in a
popup. The cross-site `form_post` and its `SameSite=Lax` collision are gone.

**8.3 The name arrives once, beside the token — not inside it.** Apple returns
`user: { name: { firstName, lastName }, email }` in the JS response on the
**first** authorization for a given user, and never again. It is *not* in the
`id_token`. So the frontend must read it there and pass it as the optional
`displayName` on `/verify`, and the backend must treat that field as a hint only:
it is caller-supplied and unverified, used solely to fill a display name when the
token carried none. It must never influence identity, email, or linking.

**8.4 The email also arrives once** and may be a per-app private relay
(`…@privaterelay.appleid.com`): verified, forwarding, and not the address the
person uses elsewhere. Consequence to accept: an Apple user and a Google user who
are the same human land on **two separate accounts**. That is what authenticated
linking from the profile is for (§11).

**8.5 `email_verified` is the string `"true"`.** §6.2.

---

## 9. Maintenance

A scheduled reaper deletes rows past their usefulness:

```
DELETE FROM oauth_nonces   WHERE expires_at < now() - interval '1 day'
DELETE FROM otp_challenges WHERE expires_at < now() - interval '7 days'
```

- Nonces are dead a day after expiry; nothing reads them.
- `OtpChallenge` is included because it has the identical unbounded-growth
  problem, and `@@index([expiresAt])` (`schema.prisma:120`) was clearly added for
  a reaper that was never written. Retention is longer because those rows carry
  `ipAddress` and are the abuse-forensics record.

> **Retention floor — 24 hours, non-negotiable.** `enforceRateLimits`
> (`otp.service.ts:159-198`) derives all four OTP limits by *counting
> `OtpChallenge` rows*, over a window of `OTP_LONG_WINDOW_MS` = 24h, and the
> service-wide daily cap counts over the same window. Deleting a row inside that
> window silently reduces someone's apparent request history and weakens the
> rate limit — the abuse control would fail open with nothing in the logs to say
> so. 7 days clears the floor by 7×. Any future change must be checked against
> `OTP_LONG_WINDOW_MS`, and the reaper's tests assert the relationship rather
> than the literal.

- Both statements are idempotent, so running on every API instance is harmless.
  No leader election needed.

### 9.1 New dependencies — two

| Package | Where | Why |
|---|---|---|
| `jose` | `apps/flick-api` | `createRemoteJWKSet` + `jwtVerify`: JWKS fetch, caching, key rotation, RS256 (Google) and ES256 (Apple) verification. One library serves both providers. |
| `@nestjs/schedule` | `apps/flick-api` | Decision 11. |

`@nestjs/jwt` signs and verifies our *own* HS256 tokens against a shared secret,
which is a different problem. Hand-rolling JWKS caching and `kid` selection
against `node:crypto` is not a third option worth costing.

**The frontend adds no npm dependency.** Both SDKs are provider-hosted scripts
loaded with `next/script`: `https://accounts.google.com/gsi/client` and
`https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`.

---

## 10. Phasing

One phase, both providers. The verification path is thin enough that Apple is a
small increment on Google rather than a project of its own, and both SDKs are
frontend work on the same screen.

---

## 11. Out of scope

1. **Linking from an authenticated profile** ("add Google to my account"). The
   schema supports it — that is what `@@unique([userId, provider])` is for — but
   the endpoint and UI are their own phase. It is also the answer to §8.4.
2. **Unlinking.** When it comes it needs one rule: refuse to remove a user's last
   remaining credential, or you lock people out of paid subscriptions.
3. **Merging two accounts** a user already created. Needs a product decision
   about what happens to two subscriptions.
4. **LINE and Facebook.** Deferred, and cheap by construction (§5). For a Thai
   audience LINE may out-convert both shipped providers.

### 11.1 Invariant this design must preserve

> `User.email` is set only where control of that address has been proven — by OTP
> delivery, or by a provider asserting `email_verified: true`.

Every future code path that writes `User.email` must satisfy this or set
`emailVerifiedAt = null`. §6.3's refusal is the tripwire; if it ever fires, this
invariant has been broken.

---

## 12. Items resolved at review

- **OTP challenge retention → 7 days** (decision 10). A privacy decision under
  Thailand's PDPA, constrained from below by the 24h rate-limit window (§9).
- **Pruning → `@nestjs/schedule`** (decision 11).
- **Architecture → client-side token flow** (§0), replacing the server-side
  redirect of revision 1.

No open items remain.
