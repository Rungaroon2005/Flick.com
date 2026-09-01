# Social Login — Design Specification

**Status:** Approved 2026-09-01. Implementation plan to follow.
**Scope of this phase:** Google. Apple is specified here but deferred to its own phase (§10).
**Supersedes nothing.** Additive to the existing passwordless OTP authentication.

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
  removed entirely in `f9acb9d` / `66603d8`. No User change is needed for
  passwordless social users on that account.
- **Sessions are already a narrow seam.** `AuthService.verifyOtp` signs
  `{ sub, email }` and `AuthController.setTokenCookie` (`auth.controller.ts:38-46`)
  sets one HttpOnly cookie. Everything downstream — `JwtStrategy`, `JwtAuthGuard`,
  `RolesGuard`, `PlaybackService`, `PaymentsService`, the frontend's
  `getSession()` — reads only that cookie.
- **Every existing `User.email` is a proven email.** The only write is
  `otp.service.ts:308`, inside `verify`, reachable only by receiving a code at
  that address. §6.3 depends on this and §11.1 preserves it.
- **The port/adapter pattern is established twice** — `PAYMENT_GATEWAY_PORT`
  (fake/Omise) and `OTP_DELIVERY_PORT` (`RoutingOtpDeliveryAdapter` over SMS and
  email), both selected by config and both failing closed on misconfiguration
  (`config.validation.ts:27-73`). Social login is the third instance, not a new
  idiom.
- **Redirect safety is already solved once.** `lib/nextParam.ts` allowlists
  `next` destinations. The server-side equivalent ports that logic rather than
  reinventing it.

---

## 3. Decision record

| # | Decision | Rationale |
|---|---|---|
| 1 | **Provider tokens are not stored.** No `accessToken`, `refreshToken` or `expiresAt` columns. | They have no job after the callback. Persisting them creates secret material at rest needing encryption and rotation, and widens what a database breach yields. Add them, encrypted, only if a concrete need to call a provider API on the user's behalf appears. |
| 2 | **Auth lives in the Nest API,** not in Next.js and not in a managed IdP. | The API's JWT cookie is already the authority for entitlement and payments. Putting auth in Next would create a second session source. A managed IdP would mean migrating existing OTP users out of our database and adding per-MAU cost. |
| 3 | **Auto-link only on a provider-verified email AND a locally-verified email.** | §6.2. The first condition blocks account takeover; the second blocks pre-hijacking. |
| 4 | **OAuth state lives in the database,** not in a cookie. | §8.2 — Apple's `form_post` callback is a cross-site POST and `sameSite: 'lax'` cookies are not sent on those. A cookie-based design breaks on Apple in a way that reads as a provider bug. |
| 5 | **Google ships first; Apple is a separate phase.** | Google is roughly a third of the work and proves the whole spine — state, resolver, session issuance, frontend. Apple then lands against an already-tested resolver. |
| 6 | **Expired `OAuthState` rows are reaped on a schedule.** | §9. Extended to cover expired `OtpChallenge` rows, which have the same unbounded-growth problem and an unused `@@index([expiresAt])` already waiting for it. |
| 7 | **`OtpChallenge` retention is 7 days.** | Long enough for debugging and abuse mitigation, short enough to keep the PDPA footprint of the stored `ipAddress` small. Floored at 24h by the rate limiter — §9. |
| 8 | **Pruning uses `@nestjs/schedule`.** | The standard NestJS mechanism, and it runs predictably regardless of traffic. The opportunistic alternative was rejected because it stops running exactly when traffic stops. |

---

## 4. Schema

### 4.1 `Identity`

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

  /// The provider's stable, immutable subject id (OIDC `sub`). NEVER the
  /// email: providers let users change their email, and Apple's may be a
  /// per-app relay address.
  providerAccountId String

  /// What the provider asserted AT LINK TIME, kept for audit. Not a source of
  /// truth for login — User.email is.
  email         String?
  emailVerified Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// The login key, and the race guard: concurrent first-time callbacks
  /// collide here rather than creating two users. See §7.
  @@unique([provider, providerAccountId])
  /// One identity per provider per user; stops a retry accumulating duplicates.
  @@unique([userId, provider])
  @@index([userId])
  @@map("identities")
}
```

No token columns, per decision 1.

### 4.2 `User` changes

```prisma
model User {
  // … unchanged …

  /// Set once ANY channel has proven control of User.email — OTP delivery, or
  /// a provider asserting email_verified. Distinct from `isVerified`, which
  /// means "proved control of their login destination", whatever that was.
  emailVerifiedAt DateTime?

  identities Identity[]

  // … unchanged …
}
```

`displayName` stays non-null. Providers do not reliably supply a name — Apple
gives it only on first authorization — so the resolver falls back to a
placeholder, the same strategy `placeholderDisplayName()` (`otp.service.ts:316`)
already uses for OTP users.

### 4.3 `OAuthState`

```prisma
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

Modelled on `OtpChallenge`: single-use via a `consumedAt` guard, expiry checked
at read time, DB-backed so the check cannot disagree with what was issued — the
reasoning already documented at `otp.service.ts:273-275`.

### 4.4 Migration properties

Purely additive: two tables, one enum, two nullable columns. One data step, in
the same migration:

> **Backfill.** `UPDATE users SET email_verified_at = created_at WHERE email IS NOT NULL`.
> Every existing email was proven by OTP (§2), so this states an existing fact
> rather than asserting a new one. Without it, every current email user hits the
> §6.3 refusal on their first Google sign-in.

No downtime. Rollback is dropping the two tables and the column.

---

## 5. Provider abstraction

```
OAuthProviderPort
  id: IdentityProvider
  buildAuthorizationUrl(params: { state, nonce, codeChallenge }): string
  exchange(params: { code, codeVerifier, nonce }): Promise<ProviderProfile>

ProviderProfile        ← the ONLY shape the resolver ever sees
  providerAccountId: string      // OIDC sub
  email: string | null
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
```

A registry maps `IdentityProvider → OAuthProviderPort`, populated from config so
an unconfigured provider is **absent** rather than half-working.

**Adding a provider later** is one enum value, one adapter, one config block, one
adapter test file. The resolver, controller, schema and frontend are untouched
beyond a button. No adapter touches the database; the resolver never learns a
provider's name. That boundary is what keeps Apple's quirks (§8) out of the
linking logic.

---

## 6. Callback logic

### 6.1 Decision flow

```
CALLBACK(provider, code, state)
│
├─ 0. Consume state — single-use UPDATE guarded on consumedAt IS NULL
│     invalid / expired / already used / wrong provider ──▶ 400, log, stop
│
├─ 0b. profile ← adapter.exchange(code, codeVerifier, nonce)
│      ID token validated: JWKS signature, iss, aud, exp, nonce
│      any failure ──▶ 401, stop
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
│     ──▶ REFUSE. 409. Log at ERROR — this should be unreachable (§6.3)
│
└─ 5. AUTO-LINK: CREATE identity → existing.id, one transaction   [linked]
```

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
not a boolean** — a truthiness check passes for `"false"` too, so the adapter
must parse it explicitly and the resolver must receive a real boolean.

### 6.3 Row 5, and why its copy is a compromise

Row 5 defends the pre-hijacking attack: an attacker creates a local account
claiming an email they do not control; the victim later signs in with Google;
auto-linking would log the victim into the attacker's account.

**After the §4.4 backfill this branch should be unreachable.** Every email in the
database is OTP-proven, and §11.1 keeps that invariant. It is defence in depth
against a future code path that sets `User.email` without proof.

That has a consequence for the message. The approved copy tells the user to sign
in with OTP and then link from their profile:

> **Thai (shipped):** `มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์`
> **English (reference):** An account with this email exists. Please log in using your usual method (OTP) to verify your identity, then link this social account from your profile settings.

That is the right guidance for the benign case — a user who genuinely owns both.
It is **wrong for the attack case**: there the local account is the attacker's,
the victim cannot sign into it, and the message sends them in a circle. We accept
that, because the alternative is handing the account over, and because the branch
should never fire. Two requirements follow:

1. **Log every occurrence at ERROR with the user id and provider.** A hit means
   an invariant broke somewhere and needs investigation, not a support macro.
2. The copy must not imply the account is *theirs*. The wording above says an
   account exists, not "your account" — keep that distinction in translation.

On enumeration: this message reveals that a Flick account exists for a given
email to a caller who has already proven to Google that they control that email.
The bar is controlling the mailbox, so this is not the open oracle the OTP flow
is careful to avoid (`otp.service.ts:56-68`), and it is bounded to emails the
caller already owns.

### 6.4 Session issuance

Identical to OTP verify, deliberately:

```
ISSUE SESSION(user)
  token ← jwtService.signAsync({ sub: user.id, email: user.email })
  setTokenCookie(res, token)        // reuse auth.controller.ts:38-46 verbatim
  302 → APP_BASE_URL + safeRedirectPath(state.redirectPath)
```

Same cookie name, flags and max-age; no new session concept. The redirect carries
a destination, never a credential — no token in a URL, body or fragment.
`safeRedirectPath` ports `lib/nextParam.ts`'s allowlist server-side: leading `/`,
never `//`, never `/\`, no tab/CR/LF. An OAuth callback that redirects anywhere
is an open redirect.

### 6.5 Endpoints

| Method | Route | Guard | Purpose |
|---|---|---|---|
| `GET` | `/auth/oauth/:provider/start` | `@Public()`, throttled | Issue state, 302 to provider |
| `GET` | `/auth/oauth/google/callback` | `@Public()`, throttled | Google redirect |
| `GET` | `/auth/oauth/providers` | `@Public()` | Which providers are configured, for the login UI |
| `POST` | `/auth/oauth/apple/callback` | `@Public()`, throttled | Apple `form_post` — Apple phase only (§8.2) |

Callback authenticity comes from the signed ID token, exactly as the payment
webhook's comes from its HMAC (`payments.controller.ts:35-41`).

---

## 7. Concurrency

A double-clicked login button, or a provider retrying a callback, produces two
concurrent runs of §6.1 for the same `providerAccountId`.

**A transaction alone does not prevent the duplicate.** Under PostgreSQL's READ
COMMITTED both transactions read "no identity" at step 1, and both proceed to
insert. Atomicity is not mutual exclusion. What actually serializes them is the
`@@unique([provider, providerAccountId])` index: one insert wins, the other
raises `P2002`.

The required handling, which is the same shape as the webhook idempotency gate in
`PaymentsService.fulfill`:

```
try:
    within $transaction(tx):
        create user (if needed)      ← same tx
        create identity              ← same tx, may raise P2002
        return user
except P2002 on (provider, providerAccountId):
    # Not an error. A concurrent callback for the same provider account won.
    identity ← Identity.findUnique([provider, providerAccountId])   # now exists
    return identity.user            # ISSUE SESSION normally
```

So a double-click yields **two successful logins**, not one login and one error.
Requirements:

- User creation and identity creation happen in **one** `$transaction`, so a
  failure after the user insert cannot leave an account with no way to sign in.
- The `P2002` catch must be narrowed to the identity constraint by inspecting
  `meta.target`. A blanket `P2002` catch would swallow unrelated unique
  violations — the exact defect found in `PaymentsService` on 2026-09-01 and
  planned for repair in `2026-09-01-security-hardening.md` Task 3. Do not
  reintroduce it here.
- Row 5's auto-link insert takes the same treatment.

---

## 8. Apple — specified now, built in the Apple phase

Recorded here so the Google phase does not build something Apple cannot use.

**8.1 The client secret is a generated JWT.** ES256, signed with a `.p8` key from
the Apple Developer portal, validity capped at 6 months. It must be minted at
runtime from the key and cached — never pasted as a static env value, or logins
stop on a date nobody wrote down. Needs `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_CLIENT_ID` (Services ID), `APPLE_PRIVATE_KEY`.

**8.2 The callback is a cross-site POST.** With `scope=name email`, Apple returns
via `response_mode=form_post`. `auth.controller.ts:42` sets `sameSite: 'lax'`,
and a Lax cookie is **not** sent on a cross-site POST. This is the reason state
lives in the database (decision 4). Any cookie-based state design works in
Google and fails in Apple.

**8.3 The email arrives once, ever.** Apple includes `email` only in the first
authorization for a given user. If the callback fails after the exchange but
before the write, it is gone permanently. Hence one transaction (§7), and hence
the resolver must tolerate `email = null` on every later sign-in — §6.1 branch 2.

**8.4 Private relay addresses.** Many users get `…@privaterelay.appleid.com`:
verified, forwarding, per-app, and *not* the address they use elsewhere. An Apple
user and a Google user who are the same human will therefore land on **two
separate accounts**. That is not a login-time problem to engineer around; it is
what authenticated linking from the profile is for (§11).

**8.5 The name is in the POST body,** not the ID token, first authorization only.

---

## 9. Maintenance

A scheduled reaper deletes rows that are past their usefulness:

```
DELETE FROM oauth_states   WHERE expires_at < now() - interval '1 day'
DELETE FROM otp_challenges WHERE expires_at < now() - interval '7 days'
```

- `OAuthState` rows are dead one day after expiry; nothing reads them.
- `OtpChallenge` is included because it has the identical unbounded-growth
  problem, and `@@index([expiresAt])` (`schema.prisma:120`) was clearly added for
  a reaper that was never written. Retention is longer than `OAuthState`'s
  because those rows carry `ipAddress` and are the abuse-forensics record.

> **Retention floor — 24 hours, non-negotiable.** `enforceRateLimits`
> (`otp.service.ts:159-198`) derives all four OTP limits by *counting
> `OtpChallenge` rows*, over a window of `OTP_LONG_WINDOW_MS` = 24h, and the
> service-wide daily cap counts over the same window. Deleting a row inside that
> window silently reduces someone's apparent request history and weakens the
> rate limit — the abuse control would fail open with nothing in the logs to say
> so. 7 days clears the floor by 7×. Any future change to this number must be
> checked against `OTP_LONG_WINDOW_MS`, and the reaper's tests assert the
> relationship rather than the literal.

- Both statements are idempotent, so running on every API instance is harmless.
  No leader election needed.
- Implementation adds `@nestjs/schedule`, the one new dependency in this design.

---

## 10. Phasing

**Google phase** — schema, resolver, state service, fake adapter, Google adapter,
start/callback/providers endpoints, login UI, reaper. Ships a working feature.

**Apple phase** — Apple adapter (secret minting, form-post, string
`email_verified`, relay emails, first-authorization name), the POST callback
route, Apple button. Lands against a resolver already proven by the Google phase.

---

## 11. Out of scope

1. **Linking from an authenticated profile** ("add Google to my account"). The
   schema supports it — that is what `@@unique([userId, provider])` is for — but
   the endpoint and UI are their own phase. It is also the answer to §8.4.
2. **Unlinking.** When it comes it needs one rule: refuse to remove a user's last
   remaining credential, or you lock people out of paid subscriptions.
3. **Merging two accounts** a user already created. Needs a product decision about
   what happens to two subscriptions.
4. **LINE and Facebook.** Deferred, and cheap by construction (§5). Worth noting
   for a Thai audience that LINE may out-convert both providers in this design.

### 11.1 Invariant this design must preserve

> `User.email` is set only where control of that address has been proven — by OTP
> delivery, or by a provider asserting `email_verified: true`.

Every future code path that writes `User.email` must satisfy this or set
`emailVerifiedAt = null`. §6.3's refusal is the tripwire; if it ever fires, this
invariant has been broken.

---

## 12. Items resolved at review

Kept as a record of what was deliberately decided rather than defaulted.

- **OTP challenge retention → 7 days.** Those rows hold `ipAddress`, so this was
  a privacy decision under Thailand's PDPA rather than an engineering one: long
  enough for debugging and abuse mitigation, short enough to keep the footprint
  minimal. Constrained from below by the 24h rate-limit window (§9).
- **Pruning → `@nestjs/schedule`.** Predictable regardless of traffic. The
  opportunistic alternative was considered and rejected.

No open items remain. This spec is ready for an implementation plan.
