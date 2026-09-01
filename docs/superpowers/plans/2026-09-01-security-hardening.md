# Security and Money-Path Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the defects found in the 2026-09-01 whole-project review that
either take a customer's money without giving them anything, or weaken an
authentication/authorization control.

**Architecture:** Nine independent fixes, each landing as its own commit with
its own regression test. Nothing here restructures a subsystem — every task
edits an existing decision point and pins the new behaviour with a test that
fails against today's code. Tasks 1-3 are the money path (`PaymentsService`),
4-5 are gateway and deployment hardening, 6-9 are auth and session edges.

**Tech Stack:** NestJS 11 + Prisma (`apps/flick-api`, jest), Next.js 16 +
React 19 (`apps/flick-app`, vitest). No new dependencies.

**Spec:** None — there is no separate design doc. This plan is argued from the
whole-project review conducted on 2026-09-01; each task reproduces the finding
it closes, in full, under **Context**. An executor needs nothing but this file.

## Global Constraints

Every task's requirements implicitly include this section.

- **No new runtime or dev dependencies.** Every fix here is achievable with
  what is already installed. A task that seems to need a package is a task
  that has been misread.
- **All UI and API copy is Thai.** Reuse existing strings verbatim. Where a
  new user-facing message is required, this plan states the exact Thai string
  to use — do not translate, invent, or "improve" it.
- **`apps/flick-api` currently has 177 passing tests; `apps/flick-app` has 89.**
  Both numbers only go up. A task that makes an existing test fail has changed
  behaviour it was not asked to change — stop and re-read the task.
- **Per-task gate, run before every commit:**
  ```bash
  cd apps/flick-api && npm test && npm run lint
  cd ../flick-app && npm test && npm run lint
  ```
- **The full CI gate** additionally runs `npm run test:e2e --workspace=flick-api`,
  `npm run build --workspaces`, and `npm run performance:check`. Task 10 runs it.
- **Never widen an error message into an oracle.** `OtpService` deliberately
  returns one identical message for every failure mode (`otp.service.ts:61-68`).
  No task here may add a more specific one.
- **The webhook is the only path that grants paid access.** No task may add a
  second one, and no task may make `handleWebhook` return non-200 for a state
  the gateway cannot fix by retrying.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `apps/flick-api/src/subscriptions/entitlement.ts` | **Create** | The one definition of which `SubscriptionStatus` values are entitled, shared by `SubscriptionsService` and `PaymentsService`. |
| `apps/flick-api/src/subscriptions/subscriptions.service.ts` | Modify | Consumes the shared constant instead of declaring its own. |
| `apps/flick-api/src/payments/payments.service.ts` | Modify | Stacks subscription time; flags paid-but-unfulfilled loudly; narrows the replay catch. |
| `apps/flick-api/src/payments/payments.service.spec.ts` | Modify | Regression tests for all three. |
| `apps/flick-api/src/payments/adapters/omise-gateway.adapter.ts` | Modify | Own-property status lookup; HMAC over raw bytes. |
| `apps/flick-api/src/payments/adapters/omise-gateway.adapter.spec.ts` | Modify | Regression tests for both. |
| `apps/flick-api/src/common/config.validation.ts` | Modify | Refuses to boot in production without an explicit `TRUST_PROXY_HOPS`. |
| `apps/flick-api/src/common/config.validation.spec.ts` | Modify | Pins that rule. |
| `apps/flick-api/src/auth/otp/otp.service.ts` | Modify | Email delivery no longer times differently for known vs unknown addresses; a soft-deleted destination fails cleanly. |
| `apps/flick-api/src/auth/otp/otp.service.spec.ts` | Modify | Regression tests for both. |
| `apps/flick-api/src/auth/auth.controller.ts` | Modify | `logout` no longer requires a live session. |
| `apps/flick-api/src/auth/auth.controller.spec.ts` | Modify | Pins that. |
| `apps/flick-app/src/lib/session.ts` | Modify | Only a 401 means "logged out". |
| `apps/flick-app/src/lib/session.test.ts` | **Create** | Pins that. |
| `apps/flick-api/src/auth/otp/destination.ts` | Modify | Comment hygiene only. |
| `apps/flick-app/src/app/subscribe/page.tsx` | Modify | Comment hygiene only. |
| `apps/flick-api/src/subscriptions/subscriptions.controller.ts` | Modify | Comment hygiene only. |

### Component checklist

- [ ] `src/subscriptions/entitlement.ts` — **new** (Task 1)
- [ ] `src/subscriptions/subscriptions.service.ts` — consumes the shared constant (Task 1)
- [ ] `src/payments/payments.service.ts` — `grantEntitlement` stacks time (Task 1)
- [ ] `src/payments/payments.service.ts` — expired/mismatch paths flagged (Task 2)
- [ ] `src/payments/payments.service.ts` — replay catch narrowed (Task 3)
- [ ] `src/payments/adapters/omise-gateway.adapter.ts` — status lookup + HMAC bytes (Task 4)
- [ ] `src/common/config.validation.ts` — `TRUST_PROXY_HOPS` required in production (Task 5)
- [ ] `apps/flick-app/src/lib/session.ts` — 401-only logout (Task 6)
- [ ] `src/auth/otp/otp.service.ts` — email timing oracle closed (Task 7)
- [ ] `src/auth/auth.controller.ts` — `logout` is `@Public()` (Task 8)
- [ ] `src/auth/otp/otp.service.ts` — soft-deleted destination fails cleanly (Task 9)
- [ ] Comment hygiene in three files (Task 10)

---

## Task 1: Subscription purchases stack instead of overlapping

**Files:**
- Create: `apps/flick-api/src/subscriptions/entitlement.ts`
- Modify: `apps/flick-api/src/subscriptions/subscriptions.service.ts:5-8`
- Modify: `apps/flick-api/src/payments/payments.service.ts:250-280`
- Test: `apps/flick-api/src/payments/payments.service.spec.ts`

**Interfaces:**
- Produces: `ENTITLED_SUBSCRIPTION_STATUSES: SubscriptionStatus[]` from
  `src/subscriptions/entitlement.ts`. Task 1 is the only task that touches it.

**Context:** This is the most expensive defect in the review, and it is live.

`grantEntitlement` (`payments.service.ts:266-278`) always writes
`startDate = new Date()` and `endDate = startDate + item.durationMs`.
`SubscriptionsService.findActive` (`subscriptions.service.ts:19-28`) then picks
the single row with the greatest `endDate`. There is no unique constraint
stopping two live subscriptions from coexisting (`schema.prisma:235` is a
plain `@@index([userId, status])`).

So a subscriber with 20 days remaining who buys again gets a row ending 30 days
from today — 10 days of value for ฿249. A subscriber who bought yesterday and
buys again gets **zero additional days** for ฿249.

Nothing prevents it: `SubscribeClient.tsx` never reads subscription state,
`subscribe/page.tsx:27-29` checks only for a session, and
`PaymentsService.createCheckout` does not look at existing entitlement. The
purchase button is live for a user who is already subscribed.

The fix is to start the new period at the end of the current one. The
entitled-status list has to be shared rather than copied, because two
definitions of "still entitled" that can drift is exactly how this class of
bug is born.

- [ ] **Step 1: Write the failing test**

Add to `apps/flick-api/src/payments/payments.service.spec.ts`, inside the
`describe` block that owns `handleWebhook` (the one defining `pendingIntent`
and `run`):

```typescript
  it('starts a new subscription where the current one ends, not today', async () => {
    const currentEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.subscription.findFirst.mockResolvedValue({ endDate: currentEnd });

    await run();

    const created = prisma.subscription.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    // Paying while still entitled must add a full period, not overlap one.
    expect(created.data.startDate).toEqual(currentEnd);
    expect((created.data.endDate as Date).getTime()).toBe(
      currentEnd.getTime() + PLAN_DURATIONS_MS.monthly,
    );
  });

  it('starts today when the user has no live subscription', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.subscription.findFirst.mockResolvedValue(null);

    const before = Date.now();
    await run();

    const created = prisma.subscription.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    const start = (created.data.startDate as Date).getTime();
    expect(start).toBeGreaterThanOrEqual(before);
    expect((created.data.endDate as Date).getTime() - start).toBe(
      PLAN_DURATIONS_MS.monthly,
    );
  });
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd apps/flick-api && npx jest payments.service.spec -t "starts a new subscription where the current one ends"
```

Expected: FAIL. The received `startDate` is today's date, not `currentEnd` —
that is the bug, stated as an assertion.

The second test passes already; it is a regression guard for the behaviour
Task 1 must **not** change. Confirm it passes now and still passes at Step 5.

- [ ] **Step 3: Extract the shared entitled-status list**

Create `apps/flick-api/src/subscriptions/entitlement.ts`:

```typescript
import { SubscriptionStatus } from '@prisma/client';

/**
 * The statuses that still entitle a user to paid content. Canceling turns off
 * renewal but preserves access through `endDate`, so CANCELED is entitled too.
 *
 * Stated once, here, because both the read path (SubscriptionsService) and the
 * write path (PaymentsService.grantEntitlement, deciding where a new period
 * starts) must agree. Two copies that drift would silently either sell a user
 * a period they already own or hand them one for free.
 */
export const ENTITLED_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.CANCELED,
];
```

Then in `apps/flick-api/src/subscriptions/subscriptions.service.ts`, delete the
local declaration at lines 5-8:

```typescript
const ENTITLED_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.CANCELED,
];
```

and import the shared one instead, updating both usages (`findActive` and
`hasActiveSubscription`) from `ENTITLED_STATUSES` to
`ENTITLED_SUBSCRIPTION_STATUSES`:

```typescript
import { ENTITLED_SUBSCRIPTION_STATUSES } from './entitlement';
```

The `SubscriptionStatus` import stays — `cancel` still writes
`SubscriptionStatus.CANCELED`.

- [ ] **Step 4: Make the grant stack**

In `apps/flick-api/src/payments/payments.service.ts`, replace the body of
`grantEntitlement` from `const startDate = new Date();` through the
`tx.subscription.create({...})` call with:

```typescript
    const now = new Date();

    // Where does this period start? At the end of the one the user already
    // owns, if any. Read inside the caller's transaction so a second webhook
    // landing concurrently cannot both read "no subscription" and both grant
    // from today.
    const current = await tx.subscription.findFirst({
      where: {
        userId: intent.userId,
        status: { in: ENTITLED_SUBSCRIPTION_STATUSES },
        endDate: { gt: now },
      },
      orderBy: { endDate: 'desc' },
      select: { endDate: true },
    });

    const startDate = current ? current.endDate : now;
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
```

Add the import at the top of the file:

```typescript
import { ENTITLED_SUBSCRIPTION_STATUSES } from '../subscriptions/entitlement';
```

`SubscriptionStatus` is already imported at `payments.service.ts:9`; leave that
import alone.

Note for the executor: `PaymentsModule` does **not** need to import
`SubscriptionsModule`. `entitlement.ts` exports a plain constant, not a
provider, so this is a file import with no DI involved.

- [ ] **Step 5: Run the tests to watch them pass**

```bash
cd apps/flick-api && npx jest payments.service.spec subscriptions
```

Expected: PASS, including the two new tests and every pre-existing one. The
older `grants a subscription with autoRenew false and the right duration` test
does not stub `subscription.findFirst`, so the mock returns `undefined`,
`current` is falsy, and the period starts today exactly as it asserts.

- [ ] **Step 6: Full gate and commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/subscriptions/entitlement.ts \
        apps/flick-api/src/subscriptions/subscriptions.service.ts \
        apps/flick-api/src/payments/payments.service.ts \
        apps/flick-api/src/payments/payments.service.spec.ts
git commit -m "fix(payments): stack a new subscription onto the current one

A subscriber who bought again while still entitled got a period starting
today, so ten remaining days plus a 30-day purchase produced 30 days, not
40 -- and buying twice in one day bought nothing at all for the second
249 baht. Nothing guarded it: the UI never reads subscription state and
createCheckout never looked. The new period now starts where the current
one ends, read inside the fulfillment transaction so two concurrent
webhooks cannot both grant from today. The entitled-status list moves to
subscriptions/entitlement.ts so the read and write paths cannot drift."
```

---

## Task 2: A payment that succeeded but granted nothing must be loud

**Files:**
- Modify: `apps/flick-api/src/payments/payments.service.ts:179-198`
- Test: `apps/flick-api/src/payments/payments.service.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the log marker string `MANUAL RECONCILIATION REQUIRED`, already
  used at `payments.service.ts:227`. No new exports.

**Context:** Two branches in `fulfill` end with money taken and nothing given:

1. `payments.service.ts:179-188` — the intent expired before the webhook
   landed. `INTENT_TTL_MS` is 15 minutes (`:22`). PromptPay and bank-transfer
   flows routinely take longer than that, so this is not a rare path. It logs
   at `warn` and returns 200.
2. `payments.service.ts:190-198` — the gateway's amount or currency disagrees
   with the recorded intent. It logs at `error` and returns 200.

Both are strictly worse than the case the code *does* shout about
(`:226-231`, grant failed → `MANUAL RECONCILIATION REQUIRED` with the intent,
user, item and event ids). Returning 200 is correct in all three — the gateway
retrying cannot fix any of them — but a `warn` with no marker means no alert
fires and no human ever reconciles.

One subtlety the fix must respect: the expiry branch runs before the
`FAILED` branch, so a *failed* charge arriving after expiry also lands there.
That is not money lost and must not raise a reconciliation alarm. Only flag
when the event itself reports success.

- [ ] **Step 1: Write the failing tests**

Add to `apps/flick-api/src/payments/payments.service.spec.ts` in the
`handleWebhook` describe block. Add `Logger` to the `@nestjs/common` import at
the top of the file if it is not already there:

```typescript
  it('flags a successful payment whose intent had already expired', async () => {
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(run()).resolves.toEqual({ received: true });

    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(
      logged.some((line) => line.includes('MANUAL RECONCILIATION REQUIRED')),
    ).toBe(true);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('does not raise reconciliation for a failed charge that arrived late', async () => {
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ status: 'FAILED' }),
    );
    prisma.paymentIntent.findUnique.mockResolvedValue(
      pendingIntent({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await run();

    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(
      logged.some((line) => line.includes('MANUAL RECONCILIATION REQUIRED')),
    ).toBe(false);
  });

  it('flags an amount mismatch for reconciliation', async () => {
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    gateway.parseWebhookEvent.mockReturnValue(
      succeededEvent({ amountSatangs: 100 }),
    );

    await expect(run()).resolves.toEqual({ received: true });

    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(
      logged.some((line) => line.includes('MANUAL RECONCILIATION REQUIRED')),
    ).toBe(true);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest payments.service.spec -t "reconciliation"
```

Expected: the expiry test and the mismatch test FAIL (`expected false to be
true`) — today one logs at `warn` and the other logs at `error` without the
marker. The "failed charge that arrived late" test passes already and is the
guard against over-flagging.

- [ ] **Step 3: Flag both paths**

In `apps/flick-api/src/payments/payments.service.ts`, replace the expiry block
(`:179-188`) with:

```typescript
        if (intent.expiresAt.getTime() < Date.now()) {
          await tx.paymentIntent.updateMany({
            where: { id: intent.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
          // A FAILED charge landing after expiry costs nobody anything. A
          // SUCCEEDED one means we took the money and granted nothing, which
          // is the same severity as a failed grant below and needs the same
          // marker for alerting to catch.
          if (event.status === 'SUCCEEDED') {
            this.logger.error(
              `MANUAL RECONCILIATION REQUIRED: payment succeeded after its intent expired. ` +
                `intent=${intent.id} user=${intent.userId} item=${intent.itemType}:${intent.itemId} ` +
                `gatewayEventId=${event.gatewayEventId} paymentEvent=${paymentEvent.id}`,
            );
          } else {
            this.logger.warn(
              `Intent ${intent.id} expired before its webhook landed`,
            );
          }
          return;
        }
```

and replace the mismatch block (`:190-198`) with:

```typescript
        if (
          event.amountSatangs !== intent.amountSatangs ||
          event.currency !== intent.currency
        ) {
          this.logger.error(
            `MANUAL RECONCILIATION REQUIRED: amount mismatch, nothing granted. ` +
              `intent=${intent.id} user=${intent.userId} ` +
              `gateway said ${event.amountSatangs} ${event.currency}, we recorded ${intent.amountSatangs} ${intent.currency} ` +
              `gatewayEventId=${event.gatewayEventId} paymentEvent=${paymentEvent.id}`,
          );
          return;
        }
```

Both blocks reference `paymentEvent`, which is in scope from `:148`.

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest payments.service.spec
```

Expected: PASS, all of them.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/payments/payments.service.ts \
        apps/flick-api/src/payments/payments.service.spec.ts
git commit -m "fix(payments): shout when money arrived and nothing was granted

An intent that expired before its webhook landed, and a webhook whose
amount disagreed with the intent, both logged quietly and returned 200 --
so no alert fired and no human reconciled, even though the customer had
paid. The 15-minute intent TTL makes the first routine for PromptPay and
bank transfer, not rare. Both now carry the same MANUAL RECONCILIATION
REQUIRED marker the failed-grant path already uses, and the expiry branch
raises it only for a SUCCEEDED event -- a failed charge arriving late
costs nobody anything and must not page anyone."
```

---

## Task 3: The replay catch must not swallow real failures

**Files:**
- Modify: `apps/flick-api/src/payments/payments.service.ts:234-246`
- Test: `apps/flick-api/src/payments/payments.service.spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: nothing exported.

**Context:** `fulfill` treats *every* `P2002` as "this webhook is a replay",
logs `Duplicate webhook ... ignored`, and returns 200.

That is right for the intended source — `PaymentEvent.gatewayEventId` and
`PaymentEvent.idempotencyKey` are both `@unique` (`schema.prisma:275-276`) and
the create at `:148` is the deliberate idempotency gate. But it is not the only
unique column the transaction writes. `PaymentIntent.gatewayChargeId` is also
`@unique` (`schema.prisma:257`) and is written at `:203` and `:213`. A
collision there is a real payment being dropped on the floor with a log line
saying everything is fine.

The fix must be careful in one direction: if it becomes *too* strict and
rethrows a genuine replay, `handleWebhook` returns non-200 and the gateway
retries forever. Prisma reports `meta.target` as an array of column names on
PostgreSQL, but the shape is not guaranteed across versions and can be a
constraint-name string. So: match by substring when a target is present, and
when the target is missing or unreadable, keep today's lenient behaviour but
say so loudly rather than pretending it was a clean replay.

- [ ] **Step 1: Write the failing test**

Add to `apps/flick-api/src/payments/payments.service.spec.ts`:

```typescript
  it('rethrows a unique violation that is not the idempotency gate', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.paymentIntent.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('collision', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['gatewayChargeId'] },
      }),
    );

    // A real payment colliding on PaymentIntent.gatewayChargeId is a dropped
    // payment, not a replay -- it must not be logged as "already recorded".
    await expect(run()).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('still absorbs a replay of the same gateway event', async () => {
    prisma.paymentIntent.findUnique.mockResolvedValue(pendingIntent());
    prisma.paymentEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['gatewayEventId'] },
      }),
    );

    await expect(run()).resolves.toEqual({ received: true });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to watch the first fail**

```bash
cd apps/flick-api && npx jest payments.service.spec -t "not the idempotency gate"
```

Expected: FAIL — the promise resolves to `{ received: true }` instead of
rejecting, because today every P2002 is read as a replay. The second test
passes now and must still pass after the change.

- [ ] **Step 3: Narrow the catch**

In `apps/flick-api/src/payments/payments.service.ts`, add this module-level
helper just below the `INTENT_TTL_MS` constant (`:22`):

```typescript
/**
 * Which unique constraints mean "we have already handled this webhook"?
 * Only PaymentEvent's. PaymentIntent.gatewayChargeId is @unique too, and a
 * collision there is a real payment being dropped -- reading it as a replay
 * would return 200 and lose it silently.
 *
 * Matched by substring because Prisma reports meta.target as either an array
 * of column names or a constraint name, depending on version and connector.
 */
const REPLAY_CONSTRAINTS = ['gatewayEventId', 'idempotencyKey'];

function replayTargets(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}
```

Then replace the `catch` block at `:234-246` with:

```typescript
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }

      const targets = replayTargets(err);
      if (targets.length === 0) {
        // Prisma gave us no target to judge by. Keep the old lenient
        // behaviour -- a rethrow here would make the gateway retry a real
        // replay forever -- but never silently: this line is the signal that
        // the assumption below needs re-checking.
        this.logger.warn(
          `Unique violation with no reportable target while handling ${event.gatewayEventId}; treating as a replay`,
        );
        return;
      }

      if (
        targets.some((target) =>
          REPLAY_CONSTRAINTS.some((constraint) => target.includes(constraint)),
        )
      ) {
        // Replay. The transaction rolled back, so nothing partial survives.
        this.logger.log(
          `Duplicate webhook ${event.gatewayEventId} ignored (already recorded)`,
        );
        return;
      }

      this.logger.error(
        `MANUAL RECONCILIATION REQUIRED: unique violation on ${targets.join(', ')} while fulfilling ` +
          `intent=${event.intentId} gatewayEventId=${event.gatewayEventId}`,
      );
      throw err;
    }
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest payments.service.spec
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/payments/payments.service.ts \
        apps/flick-api/src/payments/payments.service.spec.ts
git commit -m "fix(payments): only PaymentEvent's constraints mean replay

fulfill() read every P2002 as a duplicate webhook and returned 200. But
PaymentIntent.gatewayChargeId is @unique as well and is written inside the
same transaction, so a collision there was a real payment logged as
'already recorded' and dropped. The catch now judges by meta.target,
matched as a substring because Prisma reports either column names or a
constraint name. A target we cannot read keeps the old lenient behaviour
-- rethrowing would make the gateway retry a genuine replay forever --
but warns instead of staying silent."
```

---

## Task 4: Omise adapter — own-property status lookup and byte-exact HMAC

**Files:**
- Modify: `apps/flick-api/src/payments/adapters/omise-gateway.adapter.ts:234`, `:242-247`, `:304-309`
- Test: `apps/flick-api/src/payments/adapters/omise-gateway.adapter.spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces: no signature changes.

**Context:** Three defects in one file, all small, all in the code that decides
whether an inbound webhook is genuine.

1. **`rawStatus in STATUS_MAP` (`:304`) walks the prototype chain.** Verified by
   running it: `'constructor' in STATUS_MAP` is `true`, and
   `STATUS_MAP['constructor']` returns a function. The event would then carry a
   function as its `status`, Prisma would reject it, and the webhook would 500
   into an endless gateway retry. It is not exploitable — an attacker must
   already hold the HMAC secret to reach `parseWebhookEvent` — but this repo
   fixed exactly this bug in `catalog.ts:36` with a `hasOwnProperty` guard and
   a dedicated test (`test(payments): verify hasOwnProperty guard prevents
   prototype pollution`). Leaving the same hole in the webhook parser is an
   inconsistency a future reader will trip over.
2. **The HMAC is computed over `rawBody.toString('utf8')` (`:234`).** Any byte
   sequence that is not valid UTF-8 becomes U+FFFD, so the bytes hashed are not
   the bytes received and a legitimate signature fails. Omise sends JSON so
   this does not bite today, but the whole reason `main.ts` keeps `rawBody` is
   to hash exactly what arrived.
3. **The `try`/`catch` around `Buffer.from(candidate, 'hex')` (`:242-247`) is
   dead code.** Verified by running it: `Buffer.from('zz', 'hex')` does not
   throw, it returns a zero-length buffer. The length check on the next line is
   what actually rejects it, so the `catch` can never run.

- [ ] **Step 1: Make the spec's `sign` helper hash bytes too**

`apps/flick-api/src/payments/adapters/omise-gateway.adapter.spec.ts:33-42`
already has a `sign(rawBody, timestamp, secretB64 = webhookSecretB64)` helper,
and it makes the same mistake the adapter does:

```typescript
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
```

Change it to match what a correct sender does:

```typescript
      .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]))
```

Every existing `verifyWebhook` test uses ASCII JSON bodies, where the two forms
produce identical bytes, so this changes no existing result — confirm that in
Step 3 before touching the adapter.

- [ ] **Step 2: Write the failing tests**

The spec's outer `describe('OmiseGatewayAdapter')` already provides `gateway`
(the adapter under test, built in `beforeEach`), `webhookSecretB64`, `sign`,
and `eventBody(overrides)` which merges `overrides.data` into a valid charge.
Use them — do not build new ones.

Add to the existing `describe('parseWebhookEvent', ...)` block (`:239`):

```typescript
    it('rejects a status that only exists on the prototype chain', () => {
      // `'constructor' in STATUS_MAP` is true, and the value is a function.
      // catalog.ts guards this exact case with hasOwnProperty; this parser
      // must not disagree with it.
      const body = eventBody({ data: { status: 'constructor' } });

      expect(() => gateway.parseWebhookEvent(body)).toThrow(
        /unrecognized status/,
      );
    });
```

Add to the existing `describe('verifyWebhook', ...)` block (`:155`):

```typescript
    it('verifies over the exact bytes received, not a utf8 round-trip', async () => {
      // 0xFF is not valid UTF-8. toString('utf8') replaces it with U+FFFD, so
      // hashing the string hashes bytes the sender never signed.
      const body = Buffer.concat([
        Buffer.from('{"id":"evnt_1","raw":"'),
        Buffer.from([0xff]),
        Buffer.from('"}'),
      ]);
      const timestamp = '1700000000';

      await expect(
        gateway.verifyWebhook(body, {
          'omise-signature': sign(body, timestamp),
          'omise-signature-timestamp': timestamp,
        }),
      ).resolves.toBe(true);
    });
```

- [ ] **Step 3: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest omise-gateway.adapter.spec
```

Expected: the prototype-chain test FAILS by not throwing at all (the lookup
succeeds via the prototype chain). The byte-exact test FAILS resolving `false`
(the adapter hashed the U+FFFD-substituted string while `sign` hashed the real
bytes). **Every other test in the file must still pass** — that is the check
that Step 1's `sign` change was behaviour-preserving.

- [ ] **Step 4: Fix all three**

In `apps/flick-api/src/payments/adapters/omise-gateway.adapter.ts`:

Replace the status guard at `:304-309`:

```typescript
    if (
      !rawStatus ||
      !Object.prototype.hasOwnProperty.call(STATUS_MAP, rawStatus)
    ) {
      throw new Error(
        `Malformed Omise event: unrecognized status "${String(rawStatus)}"`,
      );
    }
```

Replace the signed-payload construction at `:234`:

```typescript
      // Hash the bytes that arrived. rawBody.toString('utf8') would replace
      // any invalid UTF-8 with U+FFFD and hash something the sender never
      // signed -- the reason main.ts preserves rawBody in the first place.
      const signedPayload = Buffer.concat([
        Buffer.from(`${timestampHeader}.`, 'utf8'),
        rawBody,
      ]);
```

Replace the candidate loop at `:241-253` (the `for (const candidate of
provided)` block) with:

```typescript
      for (const candidate of provided) {
        // Buffer.from(x, 'hex') does not throw on non-hex input -- it stops at
        // the first invalid character and returns a shorter buffer -- so the
        // length check below is what rejects junk, not a try/catch.
        const candidateBuffer = Buffer.from(candidate, 'hex');
        if (
          candidateBuffer.length === expected.length &&
          timingSafeEqual(candidateBuffer, expected)
        ) {
          return true;
        }
      }
```

- [ ] **Step 5: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest omise-gateway.adapter.spec
```

Expected: PASS, including the 311 lines of existing coverage.

- [ ] **Step 6: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/payments/adapters/omise-gateway.adapter.ts \
        apps/flick-api/src/payments/adapters/omise-gateway.adapter.spec.ts
git commit -m "fix(payments): own-property status lookup and byte-exact webhook HMAC

'constructor' in STATUS_MAP is true, so a status of that name resolved to a
function, which Prisma would reject into a 500 and an endless gateway
retry. Not reachable without the HMAC secret, but catalog.ts already
guards this exact case with hasOwnProperty and a test, and the parser
should not disagree with it. The HMAC now covers the raw bytes instead of
a utf8 round-trip that would substitute U+FFFD for any invalid byte and
hash something the sender never signed. The try/catch around the hex
decode is deleted: Buffer.from does not throw on non-hex input, it
returns a short buffer, and the length check is what rejects it."
```

---

## Task 5: Production must declare its proxy depth

**Files:**
- Modify: `apps/flick-api/src/common/config.validation.ts:24`
- Modify: `apps/flick-api/.env.example`
- Test: `apps/flick-api/src/common/config.validation.spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-4.
- Produces: nothing exported.

**Context:** `main.ts:17-23` only calls `expressApp.set('trust proxy', ...)`
when `TRUST_PROXY_HOPS` is greater than zero. Deployed behind a load balancer
without that variable set, `req.ip` is the balancer's address for every
request. Two things break at once:

- `@Throttle({ limit: 5, ttl: 60_000 })` on `POST /auth/otp/request`
  (`auth.controller.ts:55`) becomes a **global** budget of five OTP requests
  per minute for the entire service. Real users lock each other out and the
  symptom looks like an outage, not a config error.
- `OtpChallenge.ipAddress` records the balancer for every row, so the
  abuse-forensics column is worthless exactly when it is needed.

Set it too high instead, and a client-supplied `X-Forwarded-For` is trusted,
letting an attacker rotate a fake IP per request and walk past the throttle.

`config.validation.ts` already refuses to boot production with the console OTP
adapter or the fake gateway (`:27-31`, `:47-51`), on the same logic: a
misconfiguration whose symptom appears far from its cause should stop the
process. This one belongs in that list. Requiring the value to be *present*,
not non-zero — a service genuinely exposed directly sets `0` and says so.

- [ ] **Step 1: Write the failing test**

`apps/flick-api/src/common/config.validation.spec.ts:4-8` defines a `base`
object with `DATABASE_URL`, `JWT_SECRET` and `CORS_ORIGIN`, and each test
spreads it. There is no helper for a *fully valid production* config, because
until now no test needed one — production also demands `OTP_DELIVERY=live`
plus four vendor keys (`config.validation.ts:33-45`) and
`PAYMENT_GATEWAY=omise` plus two Omise keys (`:53-73`). Add that helper
directly below `base`:

```typescript
  // Everything production already demands, so a test can isolate one rule.
  const productionBase = {
    ...base,
    NODE_ENV: 'production',
    OTP_DELIVERY: 'live',
    OTP_SMS_ENDPOINT: 'https://sms.test/send',
    OTP_SMS_API_KEY: 'sms-key',
    OTP_EMAIL_ENDPOINT: 'https://email.test/send',
    OTP_EMAIL_API_KEY: 'email-key',
    PAYMENT_GATEWAY: 'omise',
    OMISE_SECRET_KEY: 'skey_live_x',
    OMISE_WEBHOOK_SECRET: Buffer.from('secret').toString('base64'),
    TRUST_PROXY_HOPS: '1',
  };
```

Then add the tests:

```typescript
  it('refuses to boot production without an explicit TRUST_PROXY_HOPS', () => {
    const { TRUST_PROXY_HOPS: _omitted, ...withoutHops } = productionBase;

    expect(() => validateEnv(withoutHops)).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('accepts an explicit zero for a directly exposed production service', () => {
    // 0 is a real answer, not a missing one: it says "nothing is in front of
    // me", which is exactly what a deployer must be forced to think about.
    expect(() =>
      validateEnv({ ...productionBase, TRUST_PROXY_HOPS: '0' }),
    ).not.toThrow();
  });

  it('rejects a TRUST_PROXY_HOPS that is not a non-negative integer', () => {
    expect(() =>
      validateEnv({ ...productionBase, TRUST_PROXY_HOPS: 'yes' }),
    ).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('leaves development alone', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', OTP_DELIVERY: 'console' }),
    ).not.toThrow();
  });
```

Note on ordering: Step 3 inserts the new rule immediately after `isProduction`
is computed, which is *before* the `OTP_DELIVERY` check. That is deliberate —
it means the first test above throws on `TRUST_PROXY_HOPS` rather than on
something else — but it also means `productionBase` must stay complete, or
later tests will fail for the wrong reason.

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest config.validation.spec -t "TRUST_PROXY_HOPS"
```

Expected: the first three FAIL (nothing throws today); the fourth passes and
guards development against becoming stricter.

- [ ] **Step 3: Add the rule**

In `apps/flick-api/src/common/config.validation.ts`, immediately after
`const isProduction = config.NODE_ENV === 'production';` (`:24`), insert:

```typescript
  // Behind a load balancer with this unset, req.ip is the balancer for every
  // request: the per-IP throttle on POST /auth/otp/request turns into a
  // service-wide budget of five per minute and OtpChallenge.ipAddress records
  // nothing useful. Set too high, a forged X-Forwarded-For walks past the same
  // throttle. There is no safe default, so production must state a number --
  // 0 is a valid, deliberate answer for a directly exposed service.
  if (isProduction) {
    const hops = config.TRUST_PROXY_HOPS;
    if (hops === undefined || hops === null || hops === '') {
      throw new Error(
        'TRUST_PROXY_HOPS must be set in production — set 0 if the service is exposed directly, or the number of proxies in front of it',
      );
    }
    const parsed = Number(hops);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(
        `TRUST_PROXY_HOPS must be a non-negative integer, got "${String(hops)}"`,
      );
    }
  }
```

Then add to `apps/flick-api/.env.example`, near the other server settings:

```bash
# Number of reverse proxies in front of this service. Required in production.
# 0 = exposed directly. Behind one load balancer = 1. This sets Express's
# 'trust proxy' and therefore what req.ip resolves to, which is what the
# per-IP OTP throttle counts against.
TRUST_PROXY_HOPS=0
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest config.validation.spec
```

Expected: PASS. Also confirm the e2e suite still boots — it sets `NODE_ENV`
to `test`, not `production`, so the new rule does not apply to it:

```bash
cd apps/flick-api && npm run test:e2e
```

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/common/config.validation.ts \
        apps/flick-api/src/common/config.validation.spec.ts \
        apps/flick-api/.env.example
git commit -m "fix(api): make production state its proxy depth

main.ts only trusts proxy headers when TRUST_PROXY_HOPS is set, so
deploying behind a load balancer without it collapses req.ip to the
balancer for everyone: the five-per-minute per-IP throttle on OTP requests
becomes a service-wide budget and users lock each other out, while
OtpChallenge.ipAddress records nothing worth having. Set too high and a
forged X-Forwarded-For walks past the same throttle. There is no safe
default, so production now refuses to boot without an explicit value; 0 is
a valid answer for a directly exposed service. Same fail-closed treatment
config.validation already gives the console OTP adapter and fake gateway."
```

---

## Task 6: Only a 401 means logged out

**Files:**
- Modify: `apps/flick-app/src/lib/session.ts:42-48`
- Create: `apps/flick-app/src/lib/session.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-5.
- Produces: no signature change — `getSession()` still returns
  `Promise<AuthenticatedUser | null>`.

**Context:** `getSession` catches `err instanceof ApiError` and returns `null`
for all of them. Its own docstring says otherwise: *"Returns null when it does
not (401), so callers fail closed. Network/API outages still throw — a broken
API is an error, not a logged-out user."* `ApiError` is thrown by
`unwrapResponse` for **every** non-ok response (`apiClient.ts:19-25`), 500s
included.

So a transient API 500 reads as "not logged in" across the whole app. Pages
that redirect on a null session — `subscribe/page.tsx:29`, and the same
pattern in `home`, `bookmarks` and `profile` — will bounce signed-in users to
`/login` during any backend blip, discarding whatever they were doing.

- [ ] **Step 1: Write the failing test**

Create `apps/flick-app/src/lib/session.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ toString: () => 'access_token=t' }),
}));

import { getSession } from './session';
import { ApiError } from './apiClient';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.restoreAllMocks());

describe('getSession', () => {
  it('returns null when the API says the caller is unauthenticated', async () => {
    respond(401, { message: 'Unauthorized' });

    await expect(getSession()).resolves.toBeNull();
  });

  it('throws when the API is broken, rather than reporting a logged-out user', async () => {
    // A 500 is an outage. Reporting it as "logged out" bounces signed-in
    // users to /login from every page that redirects on a null session.
    respond(500, { message: 'Internal server error' });

    await expect(getSession()).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd apps/flick-app && npx vitest run src/lib/session.test.ts
```

Expected: the 401 test PASSES, the 500 test FAILS — it resolves to `null`
instead of rejecting.

- [ ] **Step 3: Narrow the catch**

In `apps/flick-app/src/lib/session.ts`, replace the body of `getSession`:

```typescript
export async function getSession(): Promise<AuthenticatedUser | null> {
  try {
    return await apiFetchServer('/auth/me');
  } catch (err) {
    // Only an explicit 401 means "not logged in". Every other ApiError is the
    // API being broken, and reporting that as a logged-out user redirects
    // signed-in people to /login from every page that guards on a null
    // session.
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run it to watch it pass**

```bash
cd apps/flick-app && npx vitest run src/lib/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-app && npm test && npm run lint
git add apps/flick-app/src/lib/session.ts apps/flick-app/src/lib/session.test.ts
git commit -m "fix(app): treat only a 401 as a logged-out session

getSession() caught every ApiError and returned null, but unwrapResponse
throws ApiError for any non-ok response -- so a transient API 500 read as
'not logged in' and every page guarding on a null session bounced
signed-in users to /login mid-task. The function's own docstring already
described the intended behaviour ('a broken API is an error, not a
logged-out user'); the code now matches it."
```

---

## Task 7: Email OTP requests cannot be timed for enumeration

**Files:**
- Modify: `apps/flick-api/src/auth/otp/otp.service.ts:132-147`
- Test: `apps/flick-api/src/auth/otp/otp.service.spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-6.
- Produces: no signature change — `request()` still resolves
  `{ ref, expiresIn }`.

**Context:** `OtpService.request` goes to real trouble to be
enumeration-proof: the response body is identical whether or not the account
exists, and the comment at `:149-151` says so. The body is. The *timing* is
not.

For `OtpChannel.EMAIL`, `deliverable` is false when no verified account owns
the address (`:98-103`), and the whole `await this.delivery.send(...)` block at
`:132-147` is then skipped. That call is an HTTP request to a vendor
(`email-delivery.adapter.ts`). The difference between "made a network call" and
"did not" is tens to hundreds of milliseconds — trivially measurable, and it
answers exactly the question the identical response body was designed to hide.

There is a second, subtler leak in the same block: the `ServiceUnavailableException`
at `:143` can only ever be raised for a *deliverable* destination. A vendor
outage therefore turns into a clean oracle — 503 means the account exists, 200
means it does not.

Both close the same way: for the email channel, stop making the response wait
on delivery. SMS keeps its synchronous send — the phone number is the identity
there, delivery happens for every request, and there is nothing to compare
against.

- [ ] **Step 1: Write the failing test**

Add to the `request` describe block in
`apps/flick-api/src/auth/otp/otp.service.spec.ts`. That block already provides
`service`, `prisma`, `delivery` (`{ send: jest.Mock }`, `:24`) and the helper
`noRateLimitHits()` (`:26`) — use them rather than stubbing counts by hand.

```typescript
  it('does not make the email response wait on the vendor', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' }); // a deliverable address
    let releaseVendor: () => void = () => undefined;
    delivery.send.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseVendor = resolve;
      }),
    );

    // Resolves while the vendor call is still outstanding. A caller cannot
    // time "we sent it" against "we did not" if the send is never awaited.
    await expect(
      service.request({
        destination: 'someone@example.com',
        channel: OtpChannel.EMAIL,
        ipAddress: '1.1.1.1',
      }),
    ).resolves.toMatchObject({ ref: expect.any(String) });

    releaseVendor();
  });

  it('does not turn an email vendor outage into an account oracle', async () => {
    noRateLimitHits();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    delivery.send.mockRejectedValue(new Error('email vendor down'));

    // A 503 that can only ever fire for an address that has an account is an
    // oracle. The failure is logged, never returned.
    await expect(
      service.request({
        destination: 'someone@example.com',
        channel: OtpChannel.EMAIL,
        ipAddress: '1.1.1.1',
      }),
    ).resolves.toMatchObject({ ref: expect.any(String) });
  });
```

Do **not** add an SMS-failure test: `otp.service.spec.ts:172` already has
`surfaces a delivery failure as 503 without leaking the code`, which stubs
`delivery.send` to reject with `sms vendor down`. That test is the guard that
this task must not change SMS behaviour — watch it stay green.

- [ ] **Step 2: Run them to watch them fail**

```bash
cd apps/flick-api && npx jest otp.service.spec -t "vendor"
```

Expected: the first two FAIL (the first hangs until the test times out because
`request` awaits the send; the second rejects with
`ServiceUnavailableException`). The third passes today and is the guard that
SMS behaviour must not change.

- [ ] **Step 3: Split the two channels' delivery**

In `apps/flick-api/src/auth/otp/otp.service.ts`, replace the `if (deliverable)
{ ... }` block at `:132-147` with:

```typescript
    if (deliverable) {
      if (channel === OtpChannel.EMAIL) {
        // Never awaited, on purpose. Awaiting it would make a request for a
        // known address take measurably longer than one for an unknown
        // address -- the very thing the identical response body below exists
        // to prevent -- and would let a vendor outage answer "does this
        // account exist?" with a 503 that can only happen for a real one.
        void this.delivery
          .send(normalized, channel, code, ref)
          .catch((err: unknown) => {
            this.logger.error(
              `OTP delivery failed for ${maskDestination(normalized)}: ${
                err instanceof Error ? err.message : 'unknown error'
              }`,
            );
          });
      } else {
        try {
          await this.delivery.send(normalized, channel, code, ref);
        } catch (err) {
          // The challenge row survives, but no code was ever delivered, so it
          // is unusable. The cooldown still applies, which is what we want.
          // Safe to surface for SMS: delivery is attempted for every request
          // on this channel, so a failure reveals nothing about the account.
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
    }
```

- [ ] **Step 4: Run them to watch them pass**

```bash
cd apps/flick-api && npx jest otp.service.spec
```

Expected: PASS, including the existing OTP coverage.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/otp/otp.service.ts \
        apps/flick-api/src/auth/otp/otp.service.spec.ts
git commit -m "fix(auth): close the email enumeration oracle in request timing

The response body is identical whether or not an email has an account --
that was deliberate -- but the code skipped the vendor HTTP call entirely
for an unknown address, so the two cases differed by a measurable network
round trip. The 503 on delivery failure leaked the same fact a second way:
it could only ever fire for an address that does have an account. Email
delivery is now dispatched without being awaited and its failure is logged
rather than returned. SMS keeps its synchronous send and its 503: delivery
is attempted for every request on that channel, so neither reveals
anything."
```

---

## Task 8: Logging out must not require a live session

**Files:**
- Modify: `apps/flick-api/src/auth/auth.controller.ts:79-84`
- Test: `apps/flick-api/src/auth/auth.controller.spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-7.
- Produces: no signature change.

**Context:** `POST /auth/logout` carries no `@Public()`, so the global
`JwtAuthGuard` (`app.module.ts:39`) requires a valid token to reach it. A user
whose token has expired — or was issued before a `JWT_SECRET` rotation — gets a
401 and the `access_token` cookie is never cleared. The frontend swallows this
(`features/auth/api.ts:68-71` logs and moves on), so the user appears logged
out while a stale cookie sits in their browser.

Clearing a cookie needs no authorization: the worst an unauthenticated caller
can do is clear their own. Marking it `@Public()` makes logout do what its name
promises in every state.

- [ ] **Step 1: Write the failing test**

`apps/flick-api/src/auth/auth.controller.spec.ts` has no metadata-reflection
test today and no `logout` coverage at all — this task introduces both. It does
already provide a `res` mock with `clearCookie: jest.fn()` (`:35`), so the
behavioural half needs no new setup.

Add the import:

```typescript
import { IS_PUBLIC_KEY } from './public.decorator';
```

and the tests:

```typescript
  it('allows logout without a live session', () => {
    // Clearing a cookie needs no authorization, and the user whose token has
    // expired is exactly the one who most needs the cookie gone.
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      AuthController.prototype.logout,
    );

    expect(isPublic).toBe(true);
  });

  it('clears the session cookie on logout', () => {
    expect(controller.logout(res as never)).toEqual({ success: true });
    expect(res.clearCookie).toHaveBeenCalledWith('access_token');
  });
```

`Reflect.getMetadata` needs `reflect-metadata` loaded, which Nest's own imports
already guarantee in this suite — no extra import is required.

- [ ] **Step 2: Run it to watch it fail**

```bash
cd apps/flick-api && npx jest auth.controller.spec -t "logout without a live session"
```

Expected: FAIL — `undefined` is not `true`.

- [ ] **Step 3: Mark it public**

In `apps/flick-api/src/auth/auth.controller.ts`, add the decorator and a note
above `logout`:

```typescript
  /**
   * @Public because clearing a cookie needs no authorization — the worst an
   * unauthenticated caller achieves is clearing their own. Without this, a
   * user whose token expired gets a 401 and keeps a stale cookie: logged out
   * everywhere except in their browser.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { success: true };
  }
```

- [ ] **Step 4: Run it to watch it pass**

```bash
cd apps/flick-api && npx jest auth.controller.spec && npm run test:e2e
```

Expected: PASS. The e2e run matters here — `test/auth.e2e-spec.ts` exercises
logout against the real guard stack.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/auth.controller.ts \
        apps/flick-api/src/auth/auth.controller.spec.ts
git commit -m "fix(auth): let an expired session log itself out

logout sat behind the global JwtAuthGuard, so the user whose token had
already expired -- the one who most needs the cookie gone -- got a 401 and
kept it. The frontend swallows that failure, leaving someone who looks
logged out holding a stale cookie. Clearing a cookie needs no
authorization: the worst an unauthenticated caller achieves is clearing
their own."
```

---

## Task 9: A soft-deleted account must not brick its phone number

**Files:**
- Modify: `apps/flick-api/src/auth/otp/otp.service.ts:287-303`
- Test: `apps/flick-api/src/auth/otp/otp.service.spec.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-8.
- Produces: no signature change — `verify()` still resolves
  `{ userId, isNewUser }`.

**Context:** This one is **latent, not live** — say so in review, and do not
inflate it. `grep -rn "deletedAt" apps/flick-api/src` shows no code path that
ever *writes* `deletedAt`; there is no account-deletion endpoint yet. But the
column exists (`schema.prisma:64`), `JwtStrategy` already honours it
(`jwt.strategy.ts:28`), and the trap is armed for whoever adds deletion.

`OtpService.verify` looks for `{ ...identity, deletedAt: null }` (`:287-290`).
For a soft-deleted user that finds nothing, so it falls through to
`tx.user.create({ ...identity })` (`:294`) — which collides with
`phone String? @unique` (`schema.prisma:53`). The transaction aborts on a
P2002 the caller sees as an opaque failure, and it will abort on every future
attempt. The number is locked out of the platform permanently, and the user is
told nothing useful.

Roll the correct code in now, while it costs one query and one test.

- [ ] **Step 1: Write the failing test**

The `verify` describe block in `apps/flick-api/src/auth/otp/otp.service.spec.ts`
already provides two helpers: `liveChallenge(overrides)` (`:192`), which builds
an unconsumed, unexpired challenge row, and `verify(code = '123456', ref =
'AB2C')` (`:222`), which calls the service with matching defaults. Use both.

```typescript
  it('fails cleanly when the destination belongs to a deleted account', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(await liveChallenge());
    // No live user owns the number...
    prisma.user.findFirst.mockResolvedValueOnce(null);
    // ...but a soft-deleted one does, so create would collide on phone @unique
    // and keep colliding on every retry.
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'u_dead' });

    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
```

`liveChallenge` is `async` (`:192`) — its `codeHash` is a real bcrypt hash — so
it must be awaited. `otpChallenge.updateMany` is already stubbed to
`{ count: 1 }` in the block's `beforeEach` (`:208`); do not restub it.
`UnauthorizedException` and `OtpChannel` are already imported at `:6` and `:9`.

- [ ] **Step 2: Run it to watch it fail**

```bash
cd apps/flick-api && npx jest otp.service.spec -t "deleted account"
```

Expected: FAIL — `user.create` is called, because today nothing looks for the
deleted row.

- [ ] **Step 3: Check before creating**

In `apps/flick-api/src/auth/otp/otp.service.ts`, replace the block from
`const existing = ...` through the `user` assignment (`:287-303`) with:

```typescript
      const existing = await tx.user.findFirst({
        where: { ...identity, deletedAt: null },
        select: { id: true },
      });

      let user = existing;
      if (!user) {
        // phone and email are both @unique, so a soft-deleted row still owns
        // this destination and user.create would collide on it -- failing the
        // transaction identically on every future attempt and locking the
        // number out of the platform for good. Fail with the same opaque
        // message every other verify failure uses; a deleted account is not a
        // fact this endpoint should confirm.
        const retired = await tx.user.findFirst({
          where: { ...identity },
          select: { id: true },
        });
        if (retired) throw new UnauthorizedException(INVALID_CODE);

        user = await tx.user.create({
          data: {
            ...identity,
            displayName: placeholderDisplayName(normalized, channel),
            // They just proved control of the destination.
            isVerified: true,
            // passwordHash intentionally omitted — passwordless.
          },
          select: { id: true },
        });
      }
```

The `return { userId: user.id, isNewUser: existing === null };` line below is
unchanged and still correct.

- [ ] **Step 4: Run it to watch it pass**

```bash
cd apps/flick-api && npx jest otp.service.spec
```

Expected: PASS, with existing OTP tests untouched — they stub
`user.findFirst` to return a user on the first call, so the second lookup is
never reached.

- [ ] **Step 5: Commit**

```bash
cd apps/flick-api && npm test && npm run lint
git add apps/flick-api/src/auth/otp/otp.service.ts \
        apps/flick-api/src/auth/otp/otp.service.spec.ts
git commit -m "fix(auth): a soft-deleted account no longer bricks its number

verify() looked only for users with deletedAt null, then created one when
it found none -- colliding with phone/email @unique if a soft-deleted row
still held the destination, and colliding again on every retry, locking
that number out permanently behind an opaque error. Nothing writes
deletedAt today, so this is a trap armed for whoever adds account
deletion rather than a live defect. It now fails with the same message
every other verify failure uses: whether an account was deleted is not
something this endpoint should confirm."
```

---

## Task 10: Comment hygiene in security-adjacent files

**Files:**
- Modify: `apps/flick-api/src/auth/otp/destination.ts:20-22`, `:43-45`, `:71-73`
- Modify: `apps/flick-app/src/app/subscribe/page.tsx:21-26`
- Modify: `apps/flick-api/src/subscriptions/subscriptions.controller.ts:23-29`

**Interfaces:**
- Consumes: nothing. No behaviour changes at all — comments only.

**Context:** Three comments actively mislead a reader of security code:

1. `destination.ts` carries `// FINDING 1 FIX:`, `// FINDING 2 FIX:` and
   `// FINDING 3 FIX:` markers referring to a review that exists nowhere in the
   repo. They sit on the phone-normalisation and PII-masking logic — the exact
   code a future reviewer needs to understand from first principles.
2. `subscribe/page.tsx:24-26` explains that the page is *"Safe for the
   registration flow: /register only pushes here after POST /auth/register has
   already set the session cookie"*. Both the route and the endpoint were
   deleted in the OTP migration (`66603d8`, `f9acb9d`).
3. `subscriptions.controller.ts:25-26` says paid access is disabled *"Until a
   gateway exists"*. The Omise adapter shipped in `ccc7f80`; the endpoint is
   still correctly closed, but for a different reason — the webhook is the only
   grant path.

- [ ] **Step 1: Rewrite the three comments**

In `apps/flick-api/src/auth/otp/destination.ts`, replace each `FINDING N FIX`
marker with what the code actually does:

```typescript
  // Reject anything that is not a phone number before normalising: digits,
  // spaces, hyphens, parentheses, dots, and at most one leading '+'.
  if (!/^\+?[\d\s\-().]*$/.test(trimmed)) {
```

```typescript
  // A Thai national significant number never starts with 0 once the country
  // code is present; +660... is malformed however it was typed.
  if (e164.startsWith('+66') && e164[3] === '0') {
```

```typescript
  // Short inputs must not round-trip to themselves: a five-character
  // destination masked as "abcde" would be no mask at all.
  if (destination.length <= 5) {
```

In `apps/flick-app/src/app/subscribe/page.tsx`, replace the stale note with:

```typescript
// Keep plan selection inside the authenticated membership area: the checkout
// call needs a session, and PaymentsService reads the buyer from the JWT
// rather than the body.
```

In `apps/flick-api/src/subscriptions/subscriptions.controller.ts`, replace the
`create()` comment with:

```typescript
    // Paid access is granted only by a signature-verified webhook
    // (PaymentsService.handleWebhook). A browser request proves nothing about
    // whether money moved, so this endpoint stays closed permanently — it is
    // not waiting on an integration.
```

- [ ] **Step 2: Confirm nothing moved**

```bash
cd apps/flick-api && npm test && npm run lint
cd ../flick-app && npm test && npm run lint
```

Expected: identical counts to before this task — 177+ and 89+. A comment-only
task that changes a test result has changed code by accident.

- [ ] **Step 3: Commit**

```bash
git add apps/flick-api/src/auth/otp/destination.ts \
        apps/flick-app/src/app/subscribe/page.tsx \
        apps/flick-api/src/subscriptions/subscriptions.controller.ts
git commit -m "docs: correct three misleading comments in security code

destination.ts carried FINDING 1/2/3 FIX markers pointing at a review that
is not in this repo, sitting on the phone-normalisation and PII-masking
logic a reviewer most needs to read cold. subscribe/page.tsx explained its
safety in terms of /register and POST /auth/register, both deleted in the
OTP migration. subscriptions.controller.ts said paid activation waits for
a gateway to exist; the Omise adapter shipped, and the endpoint is closed
for a better reason -- the webhook is the only path that can prove money
moved."
```

---

## Task 11: Whole-pass verification

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: Tasks 1-10.

**Context:** Every task above ran its own suite. This confirms the whole gate
CI runs, in CI's order, and records the numbers.

- [ ] **Step 1: Full suites, in CI's order**

```bash
npm run lint --workspaces
git diff --exit-code
npm run test --workspace=flick-api
npm run test:e2e --workspace=flick-api
npm test
```

Expected: lint clean with no working-tree changes; `flick-api` at **177 + the
tests added by Tasks 1-9** (count and record the exact number); `flick-app` at
**89 + the two from Task 6**.

- [ ] **Step 2: Build and budgets**

```bash
npm run build --workspaces
npm run performance:check
```

Expected: build clean; five PASS lines and exit 0. Nothing in this plan touches
CSS, JS bundles, or posters, so the budget numbers should be unchanged from
`51df277` (573,993 / 1,543,651 / 72,485 / 1,053,843).

- [ ] **Step 3: Confirm the money path end to end**

```bash
cd apps/flick-api && npx jest payments --verbose
```

Read the test names in the output and confirm all four money-path guarantees
are named there: server-resolved price, signature-before-parse, replay
absorbed, and the two new ones — period stacking and reconciliation flagging.

- [ ] **Step 4: Commit the verification record**

```bash
git commit --allow-empty -m "docs: record verification of the security hardening pass

flick-api <N> tests + e2e + lint green; flick-app <M> tests + lint + build
green; performance:check exit 0 with budgets unchanged. Money path
re-verified end to end: server-resolved pricing, signature before parse,
replay absorbed, periods stack, and a payment that grants nothing now
raises MANUAL RECONCILIATION REQUIRED."
```

Replace `<N>` and `<M>` with the real counts from Step 1. A verification record
with placeholders in it is not a record.

---

## Sequencing and rationale

| Task | Depends on | Why here |
|---|---|---|
| 1 — stack subscriptions | — | Highest value: it is taking customers' money for nothing, today. Introduces `entitlement.ts`, which nothing else needs. |
| 2 — reconciliation markers | — | Same file as Task 1; sequenced after so each commit's diff stays readable. |
| 3 — narrow replay catch | 2 | Reuses the `MANUAL RECONCILIATION REQUIRED` marker Task 2 established on the paths that need it. |
| 4 — Omise adapter | — | Independent of 1-3; touches only the adapter and its spec. |
| 5 — TRUST_PROXY_HOPS | — | Independent. Do it before any production deploy, not after. |
| 6 — session 401 | — | Only frontend task with logic in it. Independent. |
| 7 — email timing | — | Independent. Touches the same file as Task 9, so keep them adjacent. |
| 8 — public logout | — | Independent, one decorator. |
| 9 — soft-delete trap | 7 | Same file as Task 7; sequenced after to keep the diffs apart. |
| 10 — comment hygiene | 7, 9 | Touches `destination.ts`, next door to the OTP work; run last so it does not collide. |
| 11 — verification | all | Runs the gate CI runs. |

Tasks 1-3 must land in order (same file). Tasks 4, 5, 6, 8 are fully
independent and may be done in any order or in parallel. Tasks 7 → 9 → 10 share
the OTP area and should stay in that order.

---

## Not in this plan

- **Signed, short-lived playback URLs.** `playback.service.ts:76` carries
  `// TODO: issue a short-lived signed URL`, and the review rated this the
  single largest business risk in the repo: entitlement is checked once and
  then a permanent URL is handed out, so one subscriber can share it without
  limit and the entire entitlement system becomes decorative. The seed already
  points at real media (`prisma/seed.ts:66`). It is excluded here because it is
  not a code fix — it needs a CDN and signing-key decision, a token TTL policy,
  a key-rotation story, and a player that can refresh an expired URL mid-stream.
  **It deserves its own design spec, and should be written before launch, not
  after.** Do not let this plan's completion read as "playback is secured".
- **Plan features that do not exist.** `plans.config.ts:60-75` sells "4
  อุปกรณ์", "ดาวน์โหลดได้" and "1080p/4K" for ฿249/month. There is no device
  limit, no quality switching, and the downloads route was renamed to a saved
  list in `01b8641`. This is a product and consumer-protection question — build
  the features or change the copy — not an engineering defect, and it needs a
  decision before it needs a task.
- **Expired `OtpChallenge` cleanup.** The table grows without bound; the
  `@@index([expiresAt])` at `schema.prisma:120` was clearly put there for a
  reaper that was never written. An operational concern, not a security one:
  the rows are already single-use and expiry-checked at read time.
- **Rate-limit TOCTOU in `enforceRateLimits`.** `otp.service.ts:159-198` counts
  and then creates without atomicity, so simultaneous requests can each pass
  the cooldown. Fixing it properly means a unique constraint or an advisory
  lock; the per-destination caps still bound the total, so this is a
  refinement rather than a hole.
- **JWT revocation.** Tokens live seven days (`jwt.config.ts:1`) and logout
  clears the cookie without invalidating the token. A stolen token stays valid.
  Changing that means a denylist or short tokens plus refresh — an architecture
  decision, not a fix.
