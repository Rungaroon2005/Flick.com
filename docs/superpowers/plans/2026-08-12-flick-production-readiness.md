# Flick Production-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Flick from a clickable prototype with an excellent schema into a production-ready streaming app where authentication, entitlement, and content state are enforced on the server.

**Architecture:** The Prisma schema is already production-grade and is treated as the source of truth — almost no schema changes are needed, only *code that actually uses it*. The refactor moves three responsibilities from the browser to the API: identity (JWT cookie verified by a Nest guard, not `localStorage`), entitlement (a coin ledger + subscription table, not `localStorage` counters), and content visibility (a `PUBLISHED` filter, not "return everything"). The frontend becomes a thin renderer over those endpoints.

**Tech Stack:** NestJS 11 · Prisma 7.9 (`@prisma/adapter-pg` + `pg` Pool) · PostgreSQL · Next.js 16.2 App Router (React 19) · CSS Modules · Jest 30 · Redis via Keyv

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Next.js 16: `params` and `searchParams` are `Promise`s.** Every dynamic page/layout/route handler must `await` them. Typing them as plain objects compiles but yields `undefined` at runtime.
- **Never store auth, entitlement, or wallet state in `localStorage`.** It may hold non-authoritative UI cache only (e.g. last-known display name). Every trust decision is made by the API.
- **Prisma 7 with a driver adapter.** `PrismaService` constructs `new PrismaPg(new Pool({connectionString}))` and passes `{ adapter }` to `super()`. Do not add a `url` to `datasource db` in `schema.prisma` — the URL comes from `apps/flick-api/prisma.config.ts`.
- **`cache-manager` v7 uses Keyv, not `cache-manager-redis-yet`.** The installed `cache-manager-redis-yet@5.1.5` is deprecated and incompatible; it gets removed, not wired up.
- **Money is integer satangs** (`amountSatangs`). Never introduce a float currency field.
- **Coins are a ledger.** `User.coinBalance` is a derived cache. Every balance change writes a `UserCoin` row and updates `coinBalance` inside the *same* `prisma.$transaction`.
- **All API commands run from `apps/flick-api`; all frontend commands from `apps/flick-app`.** Jest `rootDir` is `src`, so unit specs live beside their source; `test/` is e2e only (`npm run test:e2e`).
- **Thai is the primary UI language.** All new user-facing strings are Thai first; English only in code comments and logs.
- Commit after every task with the message given in that task's final step.

---

## File Structure

New and modified files, by responsibility.

### `apps/flick-api` — new

| File | Responsibility |
|---|---|
| `src/auth/jwt.strategy.ts` | Extract JWT from the `access_token` cookie, verify, load the user |
| `src/auth/jwt-auth.guard.ts` | Global guard; honours `@Public()` |
| `src/auth/public.decorator.ts` | `@Public()` route opt-out |
| `src/auth/roles.guard.ts` + `roles.decorator.ts` | `@Roles(Role.ADMIN)` enforcement |
| `src/auth/current-user.decorator.ts` | `@CurrentUser()` param decorator |
| `src/common/prisma-exception.filter.ts` | Map `PrismaClientKnownRequestError` → HTTP |
| `src/common/config.validation.ts` | Fail-fast env validation |
| `src/wallet/` | `wallet.module|service|controller.ts` + `spend-coins.dto.ts` — coin ledger |
| `src/subscriptions/` | `subscriptions.module|service|controller.ts` + `create-subscription.dto.ts` |
| `src/playback/` | `playback.module|service|controller.ts` — the single entitlement decision point |
| `src/engagement/` | `engagement.module|service|controller.ts` — bookmarks, watch history, downloads |
| `prisma/migrations/` | Migration history (currently absent) |

### `apps/flick-api` — modified

`src/main.ts` · `src/app.module.ts` · `src/prisma.service.ts` · `src/auth/auth.module.ts` · `src/auth/auth.service.ts` · `src/auth/auth.controller.ts` · `src/users/users.service.ts` · `src/movies/movies.service.ts` · `src/movies/movies.controller.ts` · `src/movies/movies.module.ts` · `src/movies/dto/create-movie.dto.ts` · `prisma/seed.ts` · all six `*.spec.ts`

### `apps/flick-app` — new

| File | Responsibility |
|---|---|
| `src/lib/apiClient.ts` | Single `fetch` wrapper: `credentials: 'include'`, JSON, typed errors |
| `src/lib/session.ts` | Server-side session read for RSCs (forwards the cookie) |
| `src/components/AuthProvider.tsx` | Client context holding the server-verified user |
| `src/app/error.tsx`, `src/app/not-found.tsx` | App Router error boundaries |

### `apps/flick-app` — modified

`src/lib/auth.ts` (gutted → re-exports) · `src/types/index.ts` · `src/app/movie/[id]/page.tsx` · `src/app/player/[id]/page.tsx` · `src/app/home/page.tsx` + `HomeClient.tsx` · `src/app/discover/*` · `src/app/bookmarks/page.tsx` · `src/app/downloads/page.tsx` · `src/app/profile/page.tsx` · `src/app/subscribe/page.tsx` · `src/app/search/page.tsx` · `src/app/layout.tsx` · `src/components/MovieCard.tsx` · `src/app/movie/[id]/MovieClient.tsx` · `src/app/movie/[id]/InfoModal.tsx` · `tsconfig.json` · `next.config.mjs`

---

# 1. Overall Refactoring Strategy

The gap in this codebase is not architectural taste — it is that the implementation layer never caught up to the schema. `schema.prisma` already models an append-only coin ledger, idempotent payment events, soft deletes, and content status. The application ignores all of it. So the strategy is **not** "redesign"; it is **"make the code honour the model it already has,"** in an order where each phase leaves the app in a shippable state.

**Phase 1 — Critical Hotfixes.** Stop the bleeding. Repair the test harness first (nothing else can be test-driven while 5 of 6 suites fail to compile), then fix the broken movie detail route, install real JWT verification, and make content queries respect `status`/`deletedAt`. Phase 1 ends by baselining Prisma migrations, which unblocks every schema-touching change downstream. After Phase 1 the app is *correct but not yet monetised*.

**Phase 2 — Database Integration.** Move trust to the server. Genres become a real M:N read path; the coin ledger and subscriptions get write endpoints backed by `$transaction`; a single `POST /playback/:episodeId/authorize` becomes the *only* place that answers "may this user watch this?". Caching switches from an in-process LRU masquerading as Redis to real Redis via Keyv. After Phase 2 the API is authoritative; the frontend is still lying.

**Phase 3 — Frontend Wiring.** Delete the fiction. `lib/auth.ts`'s localStorage layer is removed rather than rewritten, and every screen that currently fakes data (bookmarks falling back to `data.slice(0,5)`, downloads showing the first 3 movies, a fully hardcoded profile) is bound to the Phase 2 endpoints. Buttons that currently have no `onClick` get one. After Phase 3, what the user sees is what the database says.

**Phase 4 — Ops, Security, Polish.** Harden the edges: fail-fast config, a Prisma exception filter, rate limiting, helmet, correct cookie/token TTL alignment, graceful shutdown. Then accessibility (the viewport currently blocks pinch-zoom), a real HLS player replacing the `setInterval` simulation, and build hygiene.

**Two rules that hold across all phases.** (1) *The schema is the spec* — if code and schema disagree, the code is wrong. (2) *Every entitlement decision has exactly one server-side owner* — `PlaybackService`. Duplicating that logic into the client is the failure mode this whole refactor exists to eliminate.

---

# 2. Phase Execution Tasks

---

## PHASE 1 — Critical Hotfixes (Routing, Guard, Queries)

---

### Task 1.1: Repair the unit-test harness

**Target File(s):**
- Modify: `apps/flick-api/src/auth/auth.service.spec.ts`
- Modify: `apps/flick-api/src/auth/auth.controller.spec.ts`
- Modify: `apps/flick-api/src/movies/movies.service.spec.ts`
- Modify: `apps/flick-api/src/movies/movies.controller.spec.ts`
- Modify: `apps/flick-api/src/users/users.service.spec.ts`
- Create: `apps/flick-api/src/testing/prisma.mock.ts`
- Modify: `apps/flick-api/package.json`

**Objective:** 5 of the 6 Jest suites currently fail: they are untouched CLI boilerplate that instantiates services without providing their dependencies. Nothing in this plan can be test-driven until `npx jest` is green. Also add a `prisma generate` pretest hook, since the suites fail differently when the client hasn't been generated.

**Implementation Details:**

Create a reusable Prisma double. Keep it a plain object — do not reach for `jest-mock-extended` (not installed):

```ts
// src/testing/prisma.mock.ts
export type PrismaMock = ReturnType<typeof createPrismaMock>;

export const createPrismaMock = () => ({
  movie:    { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  user:     { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  userCoin: { create: jest.fn(), findMany: jest.fn() },
  subscription: { findFirst: jest.fn(), create: jest.fn() },
  episode:  { findUnique: jest.fn() },
  bookmark: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
  watchHistory: { upsert: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(createPrismaMock())),
});
```

Rewrite each spec to provide every constructor dependency. `AuthService` needs `UsersService` and `JwtService`; `MoviesService` needs `PrismaService` and `CACHE_MANAGER`:

```ts
// src/auth/auth.service.spec.ts
const usersService = { findByEmail: jest.fn(), create: jest.fn() };
const jwtService = { signAsync: jest.fn().mockResolvedValue('tok') };

const module = await Test.createTestingModule({
  providers: [
    AuthService,
    { provide: UsersService, useValue: usersService },
    { provide: JwtService, useValue: jwtService },
  ],
}).compile();
```

Replace the `should be defined` placeholder in each suite with at least one behavioural assertion. For `AuthService`, assert the two cases that matter:

```ts
it('rejects a login with an unknown email using the generic message', async () => {
  usersService.findByEmail.mockResolvedValue(null);
  await expect(service.login({ email: 'a@b.com', password: 'password123' }))
    .rejects.toThrow(UnauthorizedException);
});

it('never returns the password hash to the caller', async () => {
  usersService.findByEmail.mockResolvedValue({
    id: 'u1', email: 'a@b.com', displayName: 'A',
    passwordHash: await bcrypt.hash('password123', 4),
  });
  const result = await service.login({ email: 'a@b.com', password: 'password123' });
  expect(JSON.stringify(result)).not.toContain('passwordHash');
});
```

Add to `apps/flick-api/package.json` scripts so the generated client is always present:

```json
"pretest": "prisma generate",
"pretest:e2e": "prisma generate"
```

**Constraints / Edge Cases:**
- Do **not** delete failing specs to make the suite green — that is the failure this task exists to fix.
- Do not connect to a real database in unit specs. The `test/app.e2e-spec.ts` suite may, but leave it alone in this task.
- `bcrypt.hash` with cost 12 is slow in tests; use cost 4 in fixtures only.
- Keep `rootDir: "src"` — do not move specs into a top-level `tests/` folder.

**Verification:**

- [ ] **Step 1: Run the suite and confirm the current failure**

Run: `cd apps/flick-api && npx jest`
Expected: `Test Suites: 5 failed, 1 passed`

- [ ] **Step 2: Create the Prisma mock and rewrite all five specs** (code above)

- [ ] **Step 3: Run the suite green**

Run: `cd apps/flick-api && npx jest`
Expected: `Test Suites: 6 passed, 6 total`, and more than 6 individual tests.

- [ ] **Step 4: Commit**

```bash
git add apps/flick-api/src apps/flick-api/package.json
git commit -m "test(api): repair broken unit suites and add Prisma test double"
```

---

### Task 1.2: Fix Next.js 16 async `params` on all dynamic routes

**Target File(s):**
- Modify: `apps/flick-app/src/app/movie/[id]/page.tsx:25-26`
- Audit: `apps/flick-app/src/app/player/[id]/page.tsx`

**Objective:** `/movie/[id]` is broken on every request. `page.tsx:25` types `params` as `{ id: string }` and destructures it synchronously, but Next 16 delivers a `Promise`. `id` is `undefined`, the page fetches `/movies/undefined`, gets a 404, and renders the error state. This is the single most severe user-facing bug: the core content page of a streaming app never works.

**Implementation Details:**

The runtime already tells you exactly this:

```
Error: Route "/movie/[id]" used `params.id`. `params` is a Promise and must be
unwrapped with `await` or `React.use()` before accessing its properties.
```

Change the signature and await it:

```tsx
export default async function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...unchanged below
}
```

`player/[id]/page.tsx` is a **client** component using the `useParams()` hook — that hook is still synchronous and is correct as written. Confirm it, do not "fix" it.

While here, `getSimilarMovies` fetches the entire movie catalogue on every detail-page render and filters in memory. Leave the behaviour but add a `// TODO(Task 2.1): replace with a genre-scoped query` comment — Task 2.1 supplies the real query.

**Constraints / Edge Cases:**
- Do not add `React.use()` — this is an `async` Server Component, so `await` is the idiomatic form.
- Do not change `revalidate: 60`.
- `searchParams` follows the same rule; grep for it before declaring the audit done.

**Verification:**

- [x] **Step 1: Reproduce the failure with a stub API**

Write `/tmp/stub.mjs`:

```js
import http from 'http';
const movie = (id) => ({ id, title: 'TEST-' + id, description: 'd', posterUrl: '/posters/sathu.jpg',
  year: 2025, contentRating: 'ผู้ใหญ่', seasons: [] });
http.createServer((req, res) => {
  console.log('STUB REQUEST:', req.url);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/movies') return res.end(JSON.stringify([movie('sathu')]));
  const m = req.url.match(/^\/movies\/(.+)$/);
  if (m) { if (m[1] === 'undefined') { res.statusCode = 404; return res.end('{}'); }
           return res.end(JSON.stringify(movie(m[1]))); }
  res.end('{}');
}).listen(3001);
```

Run: `node /tmp/stub.mjs &` then `cd apps/flick-app && npx next dev -p 3100 &` then `curl -s localhost:3100/movie/sathu | grep -o 'TEST-sathu'`
Expected: no match, and the stub logs `STUB REQUEST: /movies/undefined`.

- [x] **Step 2: Apply the `await params` change** (code above)

- [x] **Step 3: Confirm the fix**

Run: `curl -s localhost:3100/movie/sathu | grep -o 'TEST-sathu'`
Expected: `TEST-sathu`. The stub log shows `/movies/sathu`, never `/movies/undefined`. The dev-server log contains no `sync-dynamic-apis` error.

- [x] **Step 4: Confirm no other route has the bug**

Run: `grep -rn "params" apps/flick-app/src/app --include=page.tsx --include=layout.tsx --include=route.ts | grep -v "Promise<"`
Expected: only the `useParams()` client-hook call in `player/[id]/page.tsx`.

- [x] **Step 5: Kill the servers and commit**

```bash
pkill -f "next dev -p 3100"; pkill -f "stub.mjs"
git add apps/flick-app/src/app/movie
git commit -m "fix(app): await async params in Next 16 dynamic routes"
```

---

### Task 1.3: Implement real JWT authentication (guard + strategy)

**Target File(s):**
- Create: `apps/flick-api/src/auth/jwt.strategy.ts`
- Create: `apps/flick-api/src/auth/jwt-auth.guard.ts`
- Create: `apps/flick-api/src/auth/public.decorator.ts`
- Create: `apps/flick-api/src/auth/roles.decorator.ts`
- Create: `apps/flick-api/src/auth/roles.guard.ts`
- Create: `apps/flick-api/src/auth/current-user.decorator.ts`
- Modify: `apps/flick-api/src/auth/auth.module.ts`
- Modify: `apps/flick-api/src/auth/auth.controller.ts`
- Modify: `apps/flick-api/src/users/users.service.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Test: `apps/flick-api/src/auth/jwt-auth.guard.spec.ts`

**Objective:** The API signs JWTs and sets an HttpOnly cookie, but **nothing ever verifies it**. There is no guard, no strategy, no `@UseGuards` anywhere in `src/`. `passport` and `passport-jwt` are installed and unused. Every endpoint is public, including `POST /movies`. Install verification and make guarded-by-default the system-wide posture.

**Interfaces:**
- **Produces (every later task consumes these):**
  - `@Public()` — opts a route out of the global guard.
  - `@CurrentUser() user: AuthenticatedUser` — where `AuthenticatedUser = { id: string; email: string | null; role: Role; coinBalance: number }`.
  - `@Roles(Role.ADMIN)` + `RolesGuard`.
  - `UsersService.findById(id: string): Promise<User | null>`.

**Implementation Details:**

The token lives in an HttpOnly cookie named `access_token` (set in `auth.controller.ts:19`), so `ExtractJwt.fromAuthHeaderAsBearerToken()` will **not** find it. Write a cookie extractor:

```ts
// src/auth/jwt.strategy.ts
const cookieExtractor = (req: Request): string | null =>
  (req?.cookies?.['access_token'] as string) ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly users: UsersService, config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Load the user rather than trusting the payload: catches deleted/demoted
  // users mid-token-life, at the cost of one indexed lookup per request.
  async validate(payload: { sub: string }) {
    const user = await this.users.findById(payload.sub);
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return { id: user.id, email: user.email, role: user.role, coinBalance: user.coinBalance };
  }
}
```

Add `findById` to `UsersService` (`findUnique({ where: { id } })`).

The guard reads the `@Public()` metadata:

```ts
// src/auth/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }
  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    return isPublic ? true : super.canActivate(ctx);
  }
}
```

Register **globally** in `app.module.ts` providers so new endpoints are protected by default:

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: RolesGuard },   // order matters: authn then authz
```

Register `JwtStrategy` in `AuthModule` providers and add `PassportModule` to its imports.

Mark exactly these routes `@Public()`: `AuthController.register`, `AuthController.login`, `AppController.getHello`, `PlansController.getPlans`, `MoviesController.findAll`, `MoviesController.findOne`. Everything else stays guarded.

Add a `GET /auth/me` endpoint returning `@CurrentUser()` — the frontend needs a server-verified identity read in Phase 3.

`RolesGuard` compares `@Roles(...)` metadata against `request.user.role`; returns `true` when no roles are declared.

**Constraints / Edge Cases:**
- Fetching the user per request is deliberate. Do **not** "optimise" it by trusting `role` from the JWT payload — a demoted admin would keep admin rights for the token's lifetime.
- `secretOrKey` uses `getOrThrow`, not the current `process.env.JWT_SECRET || 'super-secret-flick-key-for-dev-only-do-not-use-in-prod'` fallback in `auth.module.ts:12-14`. That hardcoded secret is committed to the repo; Task 4.1 removes it from `JwtModule` too.
- `cookie-parser` is already registered in `main.ts:8` — the extractor depends on it. Do not remove it.
- Do not use `AuthGuard('jwt')` inline on controllers; the global registration is the contract.

**Verification:**

- [x] **Step 1: Write the failing guard test**

```ts
// src/auth/jwt-auth.guard.spec.ts
it('allows a route marked @Public without a token', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
  const guard = new JwtAuthGuard(reflector);
  expect(guard.canActivate({ getHandler: () => {}, getClass: () => {} } as ExecutionContext)).toBe(true);
});

it('delegates to passport for a route that is not @Public', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
  const guard = new JwtAuthGuard(reflector);
  const spy = jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
    .mockReturnValue(true);
  guard.canActivate({ getHandler: () => {}, getClass: () => {} } as ExecutionContext);
  expect(spy).toHaveBeenCalled();
});
```

Run: `npx jest jwt-auth.guard` — Expected: FAIL, module not found.

- [x] **Step 2: Implement strategy, guard, decorators, and global registration** (code above)

- [x] **Step 3: Run the guard test**

Run: `npx jest jwt-auth.guard` — Expected: PASS.

- [x] **Step 4: Prove protection end-to-end**

With the API running and a seeded database:

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3001/auth/me                  # expect 401
curl -s -c /tmp/c.txt -X POST localhost:3001/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<seeded email>","password":"<seeded password>"}' >/dev/null
curl -s -b /tmp/c.txt localhost:3001/auth/me                                     # expect the user JSON
curl -s -o /dev/null -w "%{http_code}\n" localhost:3001/movies                   # expect 200 (public)
```

Live verification against a real seeded Postgres database found and fixed a real bug (see commits below) — `/auth/me` initially returned 401 with a valid cookie due to a JWT sign/verify secret mismatch (`JwtModule.register` reading `process.env` at import time vs `JwtStrategy` reading via `ConfigService` at DI time). Fixed and independently re-confirmed; a regression e2e test now guards it.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/src
git commit -m "feat(api): verify JWT cookies with a global guard and add /auth/me"
```

---

### Task 1.4: Enforce content status on read, and admin on write

**Target File(s):**
- Modify: `apps/flick-api/src/movies/movies.service.ts:26-63`
- Modify: `apps/flick-api/src/movies/movies.controller.ts:9-12`
- Modify: `apps/flick-api/prisma/seed.ts`
- Test: `apps/flick-api/src/movies/movies.service.spec.ts`

**Objective:** `findAll()` calls `findMany()` with **no `where` clause** — it serves `DRAFT` and soft-deleted movies to the public. The seed never sets `status`, so every seeded movie is `DRAFT` and only appears *by accident*. The `@@index([status, createdAt])` in the schema is currently unused. Separately, `POST /movies` is reachable by anyone.

**Implementation Details:**

Define the filter once and reuse it, so the two read paths cannot drift:

```ts
// src/movies/movies.service.ts
const PUBLISHED_FILTER = { status: ContentStatus.PUBLISHED, deletedAt: null } as const;
```

Apply to `findAll`:

```ts
const movies = await this.prisma.movie.findMany({
  where: PUBLISHED_FILTER,
  orderBy: { createdAt: 'desc' },   // uses @@index([status, createdAt])
  include: { seasons: { include: { episodes: { where: { deletedAt: null },
                                               orderBy: { episodeNumber: 'asc' } } } } },
});
```

`findOne` must not leak a draft by direct ID. Switch from `findUnique` to `findFirst` so the status predicate can be applied:

```ts
return this.prisma.movie.findFirst({ where: { id, ...PUBLISHED_FILTER }, include: { /* same */ } });
```

Return `404` (`NotFoundException`) when it resolves to `null` — the controller currently returns `null` with a `200`, which the frontend cannot distinguish from an empty movie.

Guard the write path in `movies.controller.ts`:

```ts
@Post()
@Roles(Role.ADMIN)
create(@Body() dto: CreateMovieDto) { return this.moviesService.create(dto); }
```

Set `status: 'PUBLISHED'` on every movie in `prisma/seed.ts`.

**Constraints / Edge Cases:**
- An admin previewing drafts is **out of scope**. Do not add an `includeDrafts` query param — an unauthenticated caller could pass it.
- Cache invalidation: `create()` already deletes `movies:all`. Any new mutation must do the same or the 5-minute TTL will serve stale data.
- Do not soft-delete-filter `Season` — the schema has no `deletedAt` on `Season`. It exists on `Movie` and `Episode` only.

**Verification:**

- [x] **Step 1: Write the failing test**

```ts
it('excludes draft and soft-deleted movies from findAll', async () => {
  prisma.movie.findMany.mockResolvedValue([]);
  await service.findAll();
  expect(prisma.movie.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { status: 'PUBLISHED', deletedAt: null } }),
  );
});

it('does not serve a draft movie by direct id', async () => {
  prisma.movie.findFirst.mockResolvedValue(null);
  await expect(service.findOne('draft-id')).rejects.toThrow(NotFoundException);
});
```

Run: `npx jest movies.service` — Expected: FAIL.

- [x] **Step 2: Implement the filter, the 404, the `@Roles` guard, and the seed status**

- [x] **Step 3: Run the tests**

Run: `npx jest movies.service` — Expected: PASS.

- [x] **Step 4: Verify against the database**

```bash
npx prisma db seed
curl -s localhost:3001/movies | jq 'length'                     # > 0 — seed is PUBLISHED
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3001/movies \
  -H 'content-type: application/json' -d '{}'                   # expect 401, not 400/500
```

Controller independently re-verified the negative case beyond this: inserted a genuine `DRAFT`-status movie via SQL, restarted the API to clear its in-memory cache, and confirmed it was excluded from both `GET /movies` and `GET /movies/:id` (404), then removed the test row.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api
git commit -m "fix(api): serve only published movies and require admin to create them"
```

---

### Task 1.5: Baseline Prisma migrations

**Target File(s):**
- Create: `apps/flick-api/prisma/migrations/**`
- Modify: `apps/flick-api/package.json`
- Modify: `apps/flick-api/README.md`

**Objective:** `prisma/` contains only `schema.prisma` and `seed.ts` — there is **no migration history**. The database was built with `db push`, so there is no reproducible deploy and no rollback path. Every Phase 2 task touches the database; this must land first.

**Implementation Details:**

`prisma.config.ts` already declares `migrations: { path: "prisma/migrations" }`, so no config change is needed. Baseline against the existing database rather than dropping it:

```bash
cd apps/flick-api
mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
npx prisma migrate resolve --applied 0_init
npx prisma migrate status
```

Add deploy scripts to `package.json`:

```json
"migrate:dev": "prisma migrate dev",
"migrate:deploy": "prisma migrate deploy",
"db:seed": "prisma db seed"
```

Document in `apps/flick-api/README.md`: `migrate:deploy` runs in CI/production, `migrate:dev` locally, and `db push` is never used again.

**Constraints / Edge Cases:**
- **Do not run `prisma migrate reset` on a database with real data.** `migrate resolve --applied` marks the baseline as already applied without re-running it — that is the whole point.
- If `migrate status` reports drift, the live schema and `schema.prisma` disagree. Reconcile explicitly; do not force.
- `prisma.config.ts` sets `seed: "npx ts-node prisma/seed.ts"` while `package.json` sets `"prisma": {"seed": "ts-node prisma/seed.ts"}`. Both work; leave both.

**Verification:**

- [x] **Step 1: Confirm no migrations exist**

Run: `ls apps/flick-api/prisma/` — Expected: `schema.prisma  seed.ts` only.

- [x] **Step 2: Generate and resolve the baseline** (commands above — `--to-schema-datamodel` was renamed to `--to-schema` in the installed Prisma 7.9.1 CLI; substituted per the CLI's own error message)

- [x] **Step 3: Verify a clean state**

Run: `cd apps/flick-api && npx prisma migrate status`
Expected: `Database schema is up to date!`

- [x] **Step 4: Prove reproducibility on a scratch database**

```bash
createdb flickdb_verify
DATABASE_URL="postgresql://$USER@localhost:5432/flickdb_verify?schema=public" npx prisma migrate deploy
DATABASE_URL="postgresql://$USER@localhost:5432/flickdb_verify?schema=public" npx prisma db seed
dropdb flickdb_verify
```
Expected: both succeed with no errors.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/prisma apps/flick-api/package.json apps/flick-api/README.md
git commit -m "chore(api): baseline Prisma migration history"
```

---

## PHASE 2 — Database Integration (Relations, Monetization, Redis)

---

### Task 2.1: Fix the genre relation end to end

**Target File(s):**
- Modify: `apps/flick-api/src/movies/dto/create-movie.dto.ts:36`
- Modify: `apps/flick-api/src/movies/movies.service.ts`
- Modify: `apps/flick-app/src/types/index.ts:31`
- Modify: `apps/flick-app/src/app/discover/DiscoverClient.tsx:20`
- Modify: `apps/flick-app/src/app/search/page.tsx:32`
- Test: `apps/flick-api/src/movies/movies.service.spec.ts`

**Objective:** Two bugs, one root cause. (a) `POST /movies` throws a 500: `CreateMovieDto` declares `genre: string`, but `Movie` has no `genre` scalar — genres are M:N via `MovieGenre`, so `prisma.movie.create({ data: dto })` fails Prisma validation. (b) `findAll` never `include`s genres, so `Movie.genre` in the frontend types is fiction — all six chips on `/discover` render "ไม่พบภาพยนตร์ในหมวดหมู่นี้", and genre search never matches. `MovieClient.tsx:46` already carries a comment acknowledging this.

**Interfaces:**
- **Produces:** the wire shape every frontend task consumes.

```ts
export interface Genre { id: string; name: string; slug: string }
export interface Movie {
  id: string; title: string; description: string;
  posterUrl: string | null; trailerUrl: string | null;
  year: number; contentRating: string;
  genres: Genre[];              // replaces the non-existent `genre: string`
  seasons?: Season[];
}
```

**Implementation Details:**

Replace `genre: string` in the DTO with a slug array:

```ts
@IsArray()
@ArrayNotEmpty()
@IsString({ each: true })
genreSlugs!: string[];
```

`create()` must map slugs to the join table and must not pass `genreSlugs` to Prisma:

```ts
async create(dto: CreateMovieDto) {
  const { genreSlugs, ...movieData } = dto;
  await this.cacheManager.del(CACHE_KEY_ALL_MOVIES);
  return this.prisma.movie.create({
    data: {
      ...movieData,
      genres: {
        create: genreSlugs.map((slug) => ({
          genre: { connectOrCreate: { where: { slug }, create: { slug, name: slug } } },
        })),
      },
    },
    include: { genres: { include: { genre: true } } },
  });
}
```

Both read paths must `include: { genres: { include: { genre: true } } }`, then flatten before returning so the API never leaks the join-table shape:

```ts
private toDto(movie: MovieWithRelations) {
  const { genres, ...rest } = movie;
  return { ...rest, genres: genres.map((g) => g.genre) };
}
```

Frontend: update `types/index.ts`, then fix the two filters.

```ts
// DiscoverClient.tsx — chips become slugs, compared against real data
const GENRES = [
  { label: 'ทั้งหมด', slug: null },
  { label: 'ดราม่า', slug: 'drama' },
  { label: 'ไซไฟ', slug: 'sci-fi' },
  { label: 'สยองขวัญ', slug: 'horror' },
  { label: 'อาชญากรรม', slug: 'crime' },
  { label: 'โรแมนติก', slug: 'romance' },
  { label: 'แอ็คชั่น', slug: 'action' },
];

const filtered = useMemo(
  () => (activeSlug === null
    ? initialMovies
    : initialMovies.filter((m) => m.genres.some((g) => g.slug === activeSlug))),
  [activeSlug, initialMovies],
);
```

In `search/page.tsx:32`, replace `movie.genre.toLowerCase().includes(q)` with a search over `movie.genres.map(g => g.name)`.

Finally, replace the catalogue-wide fetch in `movie/[id]/page.tsx`'s `getSimilarMovies` with a genre-scoped API call — add `GET /movies/:id/similar` returning up to 10 published movies sharing at least one genre.

**Constraints / Edge Cases:**
- `connectOrCreate` on `slug` uses the existing `@@unique` — do **not** match on `name`, which is user-visible and may be re-translated.
- `create({ name: slug, ... })` is a deliberate fallback for unknown slugs. Seeded genres already carry proper Thai names (`ดราม่า`/`drama`), so this only fires for new ones.
- The `whitelist: true, forbidNonWhitelisted: true` pipe in `main.ts:10` means a client still sending the old `genre` field now gets a `400` — that is correct, not a regression.
- Bust the `movies:all` cache key after any genre change.
- The seed only creates `drama` and `sci-fi`; add the remaining four slugs to `seed.ts` so every chip has content.

**Verification:**

- [x] **Step 1: Write the failing tests**

```ts
it('maps genre slugs onto the MovieGenre join table', async () => {
  prisma.movie.create.mockResolvedValue({ genres: [] });
  await service.create({ ...validDto, genreSlugs: ['drama'] });
  const arg = prisma.movie.create.mock.calls[0][0];
  expect(arg.data).not.toHaveProperty('genreSlugs');
  expect(arg.data.genres.create[0].genre.connectOrCreate.where).toEqual({ slug: 'drama' });
});

it('flattens genres in the response payload', async () => {
  prisma.movie.findMany.mockResolvedValue([
    { id: 'm1', genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }] },
  ]);
  const [movie] = await service.findAll();
  expect(movie.genres).toEqual([{ id: 'g1', name: 'ดราม่า', slug: 'drama' }]);
});
```

Run: `npx jest movies.service` — Expected: FAIL.

- [x] **Step 2: Implement DTO, service mapping, `toDto`, and the frontend filters**

- [x] **Step 3: Run the tests**

Run: `npx jest movies.service` — Expected: PASS.

- [x] **Step 4: Verify against a live database**

```bash
curl -s localhost:3001/movies | jq '.[0].genres'     # non-empty array of {id,name,slug}
```
Then open `/discover` and click each chip — every chip must show at least one movie.

Controller independently re-verified beyond this via curl: `GET /movies` returns all 6 seeded movies each with a real, distinct `genres` array; `GET /movies/:id/similar` returns correct genre-sharing results; promoted a test user to `ADMIN` and confirmed `POST /movies` with `genreSlugs` correctly uses `connectOrCreate` (matches existing genre rows rather than duplicating them) and that the old `genre` field is now rejected with `400`. (The `/discover` chip click-through itself was not re-run in the browser after this fix — the curl-level verification above covers the same data path.)

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/src apps/flick-app/src
git commit -m "fix(api,app): expose genres via the M:N relation and repair genre filtering"
```

---

### Task 2.2: Replace the in-memory cache with real Redis

**Target File(s):**
- Modify: `apps/flick-api/src/movies/movies.module.ts:9-12`
- Modify: `apps/flick-api/src/movies/movies.service.ts:30,34`
- Modify: `apps/flick-api/package.json`
- Modify: `AI_STATUS.md`

**Objective:** `CacheModule.register({ ttl })` with no store is an **in-process LRU**. `cache-manager-redis-yet` is installed and never imported. `movies.service.ts:30` logs "Returning movies from Redis cache" — the log lies. The cache dies on restart and is not shared across instances, so a horizontally scaled deploy would serve inconsistent data.

**Implementation Details:**

`cache-manager` v7 + `@nestjs/cache-manager` v3 use **Keyv**, not the legacy store adapters. Swap the dependency:

```bash
cd apps/flick-api
npm uninstall cache-manager-redis-yet
npm install @keyv/redis keyv
```

Register asynchronously so the URL comes from config, and fall back to in-memory when `REDIS_URL` is unset (keeps local dev and CI working without a Redis daemon):

```ts
// src/movies/movies.module.ts
CacheModule.registerAsync({
  isGlobal: false,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const url = config.get<string>('REDIS_URL');
    return {
      ttl: 300_000,
      stores: url ? [new Keyv({ store: new KeyvRedis(url) })] : [],
    };
  },
}),
```

Correct the two log lines in `movies.service.ts` to say "cache" rather than "Redis cache" — the store is now configurable, so the message should not name it.

Update `AI_STATUS.md`, which claims "Redis Cache-Aside pattern implemented in `MoviesModule` for sub-millisecond response times".

**Constraints / Edge Cases:**
- Do not make the cache module global. Only `MoviesService` uses it; a global registration makes future cache scoping harder.
- A Redis outage must not take down the API. Attach an `error` handler to the Keyv instance that logs and continues — a cache miss is degraded, not fatal.
- Cached payloads are JSON-serialised. `Date` fields come back as ISO strings, so never compare a cached `createdAt` with `instanceof Date`.
- 5-minute TTL is unchanged; do not "improve" it in this task.

**Verification:**

- [x] **Step 1: Prove the current cache is in-process**

Run: `grep -rn "redis" apps/flick-api/src/` — Expected: no matches (only the misleading log strings).

- [x] **Step 2: Swap dependencies and rewrite the module registration**

Deviation from the brief's literal sample: `new Keyv({ store: new KeyvRedis(url) })` alone does not achieve graceful degradation — node-redis's default reconnect behavior queues commands during an outage, so a request hangs indefinitely instead of failing fast. Fixed with `disableOfflineQueue: true`, with an explanatory comment. Verified as a genuine, necessary fix, not an unexplained departure.

- [x] **Step 3: Verify the cache survives a process restart**

```bash
docker run -d -p 6379:6379 --name flick-redis redis:7
REDIS_URL=redis://localhost:6379 npm run start:dev &
curl -s localhost:3001/movies > /dev/null      # miss — logs "Cache miss"
curl -s localhost:3001/movies > /dev/null      # hit
# restart the API, then:
curl -s localhost:3001/movies > /dev/null      # still a HIT — impossible with in-process LRU
redis-cli KEYS '*movies*'                       # expect the key to exist
```

- [x] **Step 4: Verify graceful degradation**

Run: `docker stop flick-redis` then `curl -s -o /dev/null -w "%{http_code}\n" localhost:3001/movies`
Expected: `200`. The API logs a cache error and serves from Postgres.

Controller independently reproduced steps 3 and 4 from scratch in a separate Redis container: confirmed a cache hit ("Returning movies from cache") on the very first request after a full API restart with no preceding cache-miss, and confirmed the degraded request returned `200` in 71ms (timed, not just status-checked) with the Redis error handler firing in the logs at the same moment.

- [x] **Step 5: Commit**

```bash
docker rm -f flick-redis
git add apps/flick-api AI_STATUS.md
git commit -m "feat(api): back the movie cache with real Redis via Keyv"
```

---

### Task 2.3: Server-side coin wallet (ledger-backed)

**Target File(s):**
- Create: `apps/flick-api/src/wallet/wallet.module.ts`
- Create: `apps/flick-api/src/wallet/wallet.service.ts`
- Create: `apps/flick-api/src/wallet/wallet.controller.ts`
- Create: `apps/flick-api/src/wallet/dto/spend-coins.dto.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Test: `apps/flick-api/src/wallet/wallet.service.spec.ts`

**Objective:** Coins live in `localStorage` (`lib/auth.ts:132-148`): `addCoins()` mints currency for free and `spendCoins()` is trivially bypassed. The schema already models this correctly — `UserCoin` is an append-only ledger with `amount`, `balanceAfter`, and a `TransactionType` enum, and `User.coinBalance` is explicitly commented as a derived cache. Write the code that uses it.

**Interfaces:**
- **Consumes:** `@CurrentUser()` (Task 1.3), `PrismaService`.
- **Produces:**
  - `GET /wallet` → `{ balance: number; transactions: CoinTransaction[] }`
  - `POST /wallet/spend` `{ episodeId: string }` → `{ balance: number; unlocked: true }`
  - `WalletService.spend(userId, amount, description, tx?)` — reusable inside an outer transaction.
  - `WalletService.credit(userId, amount, type, description, paymentEventId?)`
  - `WalletService.unlockEpisode(userId, episodeId): Promise<{ balance: number; unlocked: true }>` — the endpoint's implementation; looks up `coinCost` server-side, no-ops if already unlocked.
  - `WalletService.hasUnlocked(userId, episodeId): Promise<boolean>` — **consumed by Task 2.5**; a `userCoin.findFirst` on `{ userId, description: unlockDescription(episodeId) }`.

**Implementation Details:**

Every mutation writes a ledger row and updates the cached balance in one transaction. `balanceAfter` makes the ledger auditable without replaying history:

```ts
async spend(userId: string, amount: number, description: string) {
  if (amount <= 0) throw new BadRequestException('จำนวนเหรียญไม่ถูกต้อง');

  return this.prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { coinBalance: true } });
    if (!user) throw new NotFoundException();
    if (user.coinBalance < amount) {
      throw new BadRequestException('เหรียญไม่เพียงพอ (Insufficient coins)');
    }

    const balanceAfter = user.coinBalance - amount;
    await tx.userCoin.create({
      data: { userId, transactionType: TransactionType.SPENT,
              amount: -amount, balanceAfter, description },
    });
    await tx.user.update({ where: { id: userId }, data: { coinBalance: balanceAfter } });
    return balanceAfter;
  });
}
```

`POST /wallet/spend` takes an `episodeId`, not a raw amount — the client must never choose the price. Look up `episode.coinCost` server-side, reject if `0` (nothing to buy) or if the user already unlocked it, then call `spend()`.

Record unlocks so they are not charged twice. Reuse the `Download` model? No — it means something else. Instead, treat a `UserCoin` row whose `description` encodes the episode as the unlock record, and add a `findFirst` guard on `{ userId, description: unlockDescription(episodeId) }`. Define one helper so the format cannot drift:

```ts
const unlockDescription = (episodeId: string) => `unlock:episode:${episodeId}`;
```

`GET /wallet` returns the cached `coinBalance` plus the 50 most recent `UserCoin` rows, ordered by the existing `@@index([userId, createdAt])`.

**Constraints / Edge Cases:**
- **Never** trust a client-supplied amount or price. The endpoint accepts an episode id only.
- The balance check and the write must be in the same `$transaction`, or two concurrent spends can both pass the check and drive the balance negative.
- `amount` is negative for spends and positive for credits — that is the schema's convention (`// Positive for gain, negative for spend`). Honour it.
- Purchasing coins for real money is **out of scope**. `PaymentEvent` has `idempotencyKey` and `gatewayEventId` ready for a gateway integration; leave it unimplemented rather than faking it.
- `UserCoin.user` is `onDelete: Restrict` — a user with ledger rows cannot be hard-deleted. Use `deletedAt`.

**Verification:**

- [x] **Step 1: Write the failing tests**

```ts
it('refuses to spend more coins than the user holds', async () => {
  tx.user.findUnique.mockResolvedValue({ coinBalance: 5 });
  await expect(service.spend('u1', 10, 'unlock:episode:e1')).rejects.toThrow(BadRequestException);
  expect(tx.userCoin.create).not.toHaveBeenCalled();
});

it('writes a negative ledger row with the correct balanceAfter', async () => {
  tx.user.findUnique.mockResolvedValue({ coinBalance: 100 });
  await service.spend('u1', 30, 'unlock:episode:e1');
  expect(tx.userCoin.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ amount: -30, balanceAfter: 70, transactionType: 'SPENT' }),
  });
  expect(tx.user.update).toHaveBeenCalledWith({
    where: { id: 'u1' }, data: { coinBalance: 70 },
  });
});

it('does not charge twice for the same episode', async () => {
  tx.userCoin.findFirst.mockResolvedValue({ id: 'existing' });
  await expect(service.unlockEpisode('u1', 'e1')).resolves.toMatchObject({ unlocked: true });
  expect(tx.userCoin.create).not.toHaveBeenCalled();
});
```

Run: `npx jest wallet` — Expected: FAIL.

- [x] **Step 2: Implement the module, service, controller, and DTO**

- [x] **Step 3: Run the tests**

Run: `npx jest wallet` — Expected: PASS.

- [x] **Step 4: Verify the ledger reconciles in the database**

After spending against a live API, run in `psql`:

```sql
SELECT u."coinBalance",
       (SELECT COALESCE(SUM(amount),0) FROM user_coins WHERE "userId" = u.id) AS ledger_sum
FROM users u WHERE u.id = '<user id>';
```
Expected: the two columns are equal.

Task reviewer found the plain `$transaction`-wrapped check-then-write in the original implementation was NOT actually safe under Postgres's default READ COMMITTED isolation — a precomputed balance literal could be lost-updated by a concurrent spend, and `unlockEpisode()`'s double-charge guard ran outside its own transaction. Controller independently confirmed the race (re-derived Postgres's UPDATE re-check semantics) before accepting the finding, then independently reproduced both races closed after the fix, using real concurrent HTTP requests (`curl ... & curl ... & wait`) against the live database: a lost-update test (exactly one of two concurrent spends succeeded, the other correctly rejected) and a double-charge test (two concurrent unlocks of the same episode produced exactly one charge row). Fix: `SELECT ... FOR UPDATE` row lock acquired first inside every wallet transaction (`spend`, `credit`, `unlockEpisode`), via Prisma's parameterized tagged-template `$queryRaw`.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/src
git commit -m "feat(api): add ledger-backed coin wallet with transactional spend"
```

---

### Task 2.4: Server-side subscriptions

**Target File(s):**
- Create: `apps/flick-api/src/subscriptions/subscriptions.module.ts`
- Create: `apps/flick-api/src/subscriptions/subscriptions.service.ts`
- Create: `apps/flick-api/src/subscriptions/subscriptions.controller.ts`
- Create: `apps/flick-api/src/subscriptions/dto/create-subscription.dto.ts`
- Modify: `apps/flick-api/src/plans/plans.config.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Test: `apps/flick-api/src/subscriptions/subscriptions.service.spec.ts`

**Objective:** `subscribe()` in `lib/auth.ts:100-116` grants VIP for free with a `localStorage.setItem`. It also contains a revenue bug: `subscribe/page.tsx:85` passes `'vip-weekly'`, but the durations map is keyed `weekly`/`monthly`/`trial`, so the lookup misses and falls through to `|| durations.monthly` — **฿49 buys 30 days.** Move subscriptions to the `Subscription` table and make plan ids a single shared source of truth so the mismatch cannot recur.

**Interfaces:**
- **Produces:**
  - `GET /subscriptions/me` → `{ status: SubscriptionStatus; planType: string; endDate: string } | null`
  - `POST /subscriptions` `{ planId: 'weekly' | 'monthly' }` → the created subscription
  - `DELETE /subscriptions/me` → cancels (sets `CANCELED`, `autoRenew: false`)
  - `SubscriptionsService.hasActiveSubscription(userId): Promise<boolean>` — consumed by Task 2.5.

**Implementation Details:**

Make `plans.config.ts` authoritative for ids **and** durations, and export a derived type so a typo becomes a compile error:

```ts
export const PLAN_DURATIONS_MS = {
  weekly:  7  * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export type PaidPlanId = keyof typeof PLAN_DURATIONS_MS;
```

The DTO validates against those keys, so `'vip-weekly'` is rejected with a `400` rather than silently upgraded:

```ts
@IsIn(Object.keys(PLAN_DURATIONS_MS))
planId!: PaidPlanId;
```

`create()` computes dates server-side — never from the client:

```ts
const now = new Date();
return this.prisma.subscription.create({
  data: {
    userId, planType: planId, status: SubscriptionStatus.ACTIVE,
    startDate: now,
    endDate: new Date(now.getTime() + PLAN_DURATIONS_MS[planId]),
    paymentMethod: 'none',      // no gateway yet — see constraints
    autoRenew: true,
  },
});
```

`hasActiveSubscription` uses the existing `@@index([userId, status])`:

```ts
const active = await this.prisma.subscription.findFirst({
  where: { userId, status: SubscriptionStatus.ACTIVE, endDate: { gt: new Date() } },
  select: { id: true },
});
return active !== null;
```

**Constraints / Edge Cases:**
- **No payment gateway is wired.** `paymentMethod: 'none'` is an explicit placeholder. Do not fabricate a `PaymentEvent` row for an unpaid subscription — that would corrupt the financial ledger. Leave a `// TODO: create PaymentEvent on gateway callback` comment where the gateway will hook in.
- Reject a second `ACTIVE` subscription for the same user with a `409`.
- Expiry is evaluated by the `endDate > now` predicate, **not** by a background job that flips `status`. `EXPIRED` remains available for a future cron; do not add one now.
- `gatewaySubscriptionId` is `@unique` and nullable — leave it `null`. Do not write a placeholder string; a second `null` is fine, a second `'pending'` would collide.
- Times are UTC. `endDate` is a `DateTime`; do not format it in the service.

**Verification:**

- [x] **Step 1: Write the failing tests**

Also added a 4th test asserting the row lock is acquired before the active-subscription check (see Step 2 note).

```ts
it('grants exactly 7 days for the weekly plan', async () => {
  const before = Date.now();
  await service.create('u1', 'weekly');
  const { startDate, endDate } = prisma.subscription.create.mock.calls[0][0].data;
  expect(endDate.getTime() - startDate.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  expect(startDate.getTime()).toBeGreaterThanOrEqual(before);
});

it('rejects the legacy vip-weekly plan id rather than defaulting to monthly', async () => {
  await expect(service.create('u1', 'vip-weekly' as never)).rejects.toThrow(BadRequestException);
});

it('treats an expired subscription as inactive', async () => {
  prisma.subscription.findFirst.mockResolvedValue(null);
  await expect(service.hasActiveSubscription('u1')).resolves.toBe(false);
  expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ endDate: { gt: expect.any(Date) } }),
    }),
  );
});
```

Run: `npx jest subscriptions` — Expected: FAIL.

- [x] **Step 2: Implement the config constants, DTO, service, controller, and module**

Proactively hardened beyond the brief's literal text: `create()`'s "reject a second ACTIVE subscription" check was the exact same check-then-create race Task 2.3 had to fix reactively (no unique constraint backstops it in the schema). Folded in the same `SELECT ... FOR UPDATE` row-lock pattern from `WalletService` before dispatching this task, rather than waiting for review to catch it again. First task on this branch to get concurrency-hardening right on the first attempt.

- [x] **Step 3: Run the tests**

Run: `npx jest subscriptions` — Expected: PASS.

- [x] **Step 4: Verify the duration bug is dead**

```bash
curl -s -b /tmp/c.txt -X POST localhost:3001/subscriptions \
  -H 'content-type: application/json' -d '{"planId":"weekly"}' | jq '.startDate, .endDate'
# expect exactly 7 days apart
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/c.txt -X POST localhost:3001/subscriptions \
  -H 'content-type: application/json' -d '{"planId":"vip-weekly"}'   # expect 400
```

Controller independently re-verified beyond this: confirmed the 7-day duration directly, confirmed `vip-weekly` rejected at the DTO layer (400, before the service even runs), confirmed 409 on a duplicate active subscription, and fired two genuinely concurrent `POST /subscriptions` requests (backgrounded curl + wait) for the same user — exactly one `201`, one `409`, and a direct `SELECT COUNT(*) WHERE status='ACTIVE'` confirmed exactly one row, not two.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/src
git commit -m "feat(api): move subscriptions to the database and fix the weekly-plan duration bug"
```

---

### Task 2.5: Single playback-authorization endpoint

**Target File(s):**
- Create: `apps/flick-api/src/playback/playback.module.ts`
- Create: `apps/flick-api/src/playback/playback.service.ts`
- Create: `apps/flick-api/src/playback/playback.controller.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Test: `apps/flick-api/src/playback/playback.service.spec.ts`

**Objective:** Establish the one place that answers "may this user watch this episode?". `canPlayEpisode()` in `lib/auth.ts:217-221` is client-side, trivially bypassed, and **never called by anything**. Centralising the decision server-side is what stops the entitlement logic from being re-scattered later.

**Interfaces:**
- **Consumes:** `SubscriptionsService.hasActiveSubscription`, `WalletService.spend`, `PrismaService`.
- **Produces:** `GET /playback/:episodeId/authorize` →

```ts
type PlaybackAuthorization =
  | { allowed: true;  reason: 'free' | 'subscription' | 'unlocked'; videoUrl: string }
  | { allowed: false; reason: 'subscription_required' | 'coins_required'; coinCost: number };
```

**Implementation Details:**

Resolve entitlement in a fixed precedence, cheapest check first:

```ts
async authorize(userId: string, episodeId: string): Promise<PlaybackAuthorization> {
  const episode = await this.prisma.episode.findFirst({
    where: { id: episodeId, deletedAt: null },
    select: { id: true, videoUrl: true, isPremium: true, coinCost: true },
  });
  if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

  if (!episode.isPremium && episode.coinCost === 0) {
    return { allowed: true, reason: 'free', videoUrl: episode.videoUrl! };
  }
  if (await this.subscriptions.hasActiveSubscription(userId)) {
    return { allowed: true, reason: 'subscription', videoUrl: episode.videoUrl! };
  }
  if (await this.wallet.hasUnlocked(userId, episodeId)) {
    return { allowed: true, reason: 'unlocked', videoUrl: episode.videoUrl! };
  }
  return {
    allowed: false,
    reason: episode.coinCost > 0 ? 'coins_required' : 'subscription_required',
    coinCost: episode.coinCost,
  };
}
```

**`videoUrl` must never appear in a denied response.** That is the entire security property of this endpoint — the movie/episode list endpoints must therefore also stop returning `videoUrl`. Add `videoUrl` to an omit list in `MoviesService.toDto` (Task 2.1) so the URL is only ever reachable through `/playback/:id/authorize`.

**Constraints / Edge Cases:**
- Do not add caching here. Entitlement changes the instant a user spends coins; a stale cache would grant or deny wrongly.
- `videoUrl` is nullable in the schema. If an allowed episode has `videoUrl === null`, throw a `503` ("ตอนนี้ยังไม่พร้อมรับชม") rather than returning `null` — an allowed response with no URL is a contract violation.
- The route is **not** `@Public()`. An anonymous viewer gets a `401`, which the frontend turns into a login redirect.
- Signed/expiring URLs are out of scope. Leave a `// TODO: issue a short-lived signed URL` comment at the return site.
- Never accept `coinCost` from the request. It is read from the episode row.

**Verification:**

- [x] **Step 1: Write the failing tests**

```ts
it('allows a free episode without touching subscription or wallet', async () => {
  prisma.episode.findFirst.mockResolvedValue({ id: 'e1', videoUrl: 'u', isPremium: false, coinCost: 0 });
  await expect(service.authorize('u1', 'e1'))
    .resolves.toEqual({ allowed: true, reason: 'free', videoUrl: 'u' });
  expect(subscriptions.hasActiveSubscription).not.toHaveBeenCalled();
});

it('never leaks videoUrl when access is denied', async () => {
  prisma.episode.findFirst.mockResolvedValue({ id: 'e1', videoUrl: 'SECRET', isPremium: true, coinCost: 10 });
  subscriptions.hasActiveSubscription.mockResolvedValue(false);
  wallet.hasUnlocked.mockResolvedValue(false);
  const result = await service.authorize('u1', 'e1');
  expect(result.allowed).toBe(false);
  expect(JSON.stringify(result)).not.toContain('SECRET');
});

it('lets an active subscriber watch a premium episode', async () => {
  prisma.episode.findFirst.mockResolvedValue({ id: 'e1', videoUrl: 'u', isPremium: true, coinCost: 10 });
  subscriptions.hasActiveSubscription.mockResolvedValue(true);
  await expect(service.authorize('u1', 'e1'))
    .resolves.toMatchObject({ allowed: true, reason: 'subscription' });
});
```

Run: `npx jest playback` — Expected: FAIL.

- [x] **Step 2: Implement the module, service, and controller; strip `videoUrl` from `MoviesService.toDto`**

The `toDto` fix genuinely deletes the `videoUrl` key (destructure-omit) rather than nulling it — required since the seed data is always-null, so a naive null-check would pass while still leaking a real URL once one exists.

- [x] **Step 3: Run the tests**

Run: `npx jest playback` — Expected: PASS.

- [x] **Step 4: Verify no other endpoint leaks the URL**

```bash
curl -s localhost:3001/movies | grep -c videoUrl                   # expect 0
curl -s -o /dev/null -w "%{http_code}\n" localhost:3001/playback/<id>/authorize   # expect 401 anonymous
curl -s -b /tmp/c.txt localhost:3001/playback/<premium-id>/authorize | jq '.allowed, .videoUrl'
# expect false, null
```

Since the seed data's `videoUrl` is always null, this check alone can't distinguish "leak fixed" from "nothing to leak." Both the implementer and the controller independently set a real, distinctive `videoUrl` on a premium episode via SQL, confirmed it was completely absent (not just null) from `/movies` and `/movies/:id`, confirmed a denied `/playback/.../authorize` leaked nothing, then unlocked the episode via the real wallet endpoint and confirmed the exact secret was returned only once access was genuinely granted — each verification run used a different secret value. Task review then found this property had zero automated regression coverage; a follow-up fix round added `findAll`/`findOne` tests asserting `.not.toHaveProperty('videoUrl')` with real RED→GREEN proof.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/src
git commit -m "feat(api): centralize playback entitlement and stop leaking videoUrl"
```

---

### Task 2.6: Engagement API — bookmarks, watch history, downloads

**Target File(s):**
- Create: `apps/flick-api/src/engagement/engagement.module.ts`
- Create: `apps/flick-api/src/engagement/engagement.service.ts`
- Create: `apps/flick-api/src/engagement/engagement.controller.ts`
- Create: `apps/flick-api/src/engagement/dto/update-progress.dto.ts`
- Modify: `apps/flick-api/src/app.module.ts`
- Test: `apps/flick-api/src/engagement/engagement.service.spec.ts`

**Objective:** `Bookmark`, `WatchHistory`, and `Download` tables exist with correct unique constraints and indexes, and nothing reads or writes them. `toggleBookmark`, `updateWatchProgress`, and `addDownload` in `lib/auth.ts` have **zero callers** — which is why the bookmark and download buttons in `MovieClient.tsx:56-69` have no `onClick` at all. Provide the endpoints Phase 3 will wire.

**Interfaces:**
- **Produces:**
  - `GET /me/bookmarks` → `Movie[]`
  - `PUT /me/bookmarks/:movieId` → `{ bookmarked: true }`
  - `DELETE /me/bookmarks/:movieId` → `{ bookmarked: false }`
  - `GET /me/continue-watching` → `Array<{ movie: Movie; episode: Episode; progressSeconds: number }>`
  - `PUT /me/watch-history/:episodeId` `{ progressSeconds: number }` → `WatchHistory`
  - `GET /me/downloads` → `Download[]`
  - `PUT /me/downloads/:episodeId` / `DELETE /me/downloads/:episodeId`

**Implementation Details:**

Use explicit `PUT`/`DELETE` rather than a `POST /toggle`. Toggle endpoints are not idempotent, and a double-tap on mobile silently reverses the user's intent.

Bookmarks lean on `@@unique([userId, movieId])`:

```ts
add:    () => this.prisma.bookmark.upsert({
          where: { userId_movieId: { userId, movieId } }, create: { userId, movieId }, update: {} }),
remove: () => this.prisma.bookmark.deleteMany({ where: { userId, movieId } }),
```

Watch progress uses `@@unique([userId, episodeId])` and derives `completed` server-side from the episode's own duration — never from a client-supplied total:

```ts
const episode = await this.prisma.episode.findUniqueOrThrow({
  where: { id: episodeId }, select: { durationMinutes: true },
});
const completed = progressSeconds >= episode.durationMinutes * 60 * 0.9;
return this.prisma.watchHistory.upsert({
  where: { userId_episodeId: { userId, episodeId } },
  create: { userId, episodeId, progressSeconds, completed },
  update: { progressSeconds, completed },
});
```

`GET /me/continue-watching` returns `where: { userId, completed: false }`, ordered by `updatedAt desc`, take 10 — matching `@@index([userId, updatedAt])`.

Downloads require `expiresAt` (non-nullable). Set it to `now + 30 days` and reject a download request unless `/playback/:episodeId/authorize` would allow it — call `PlaybackService.authorize` rather than reimplementing the check.

**Constraints / Edge Cases:**
- `deleteMany` rather than `delete` for un-bookmarking: `delete` throws `P2025` when the row is absent, but removing a non-existent bookmark should be a successful no-op.
- Reject negative `progressSeconds` with a `@Min(0)` in the DTO.
- **Downloads must be entitlement-checked.** Otherwise it becomes a side door around Task 2.5.
- Do not offer bulk endpoints for migrating a user's existing `localStorage` data — that data is unauthenticated and untrustworthy. Task 3.1 discards it.
- `Download` and `Bookmark` are `onDelete: Cascade` — no manual cleanup needed on user deletion.

**Verification:**

- [x] **Step 1: Write the failing tests**

```ts
it('treats removing an absent bookmark as a successful no-op', async () => {
  prisma.bookmark.deleteMany.mockResolvedValue({ count: 0 });
  await expect(service.removeBookmark('u1', 'm1')).resolves.toEqual({ bookmarked: false });
});

it('derives completion from the episode duration, not from client input', async () => {
  prisma.episode.findUniqueOrThrow.mockResolvedValue({ durationMinutes: 10 });
  await service.updateProgress('u1', 'e1', 570);   // 95% of 600s
  expect(prisma.watchHistory.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ create: expect.objectContaining({ completed: true }) }),
  );
});

it('refuses to record a download for an unauthorized episode', async () => {
  playback.authorize.mockResolvedValue({ allowed: false, reason: 'coins_required', coinCost: 10 });
  await expect(service.addDownload('u1', 'e1')).rejects.toThrow(ForbiddenException);
});
```

Run: `npx jest engagement` — Expected: FAIL. Verified: 3 brief-mandated tests plus 8 additional tests written up front (13 total after fix round 1), covering bookmark upsert idempotency, bookmarks list, completion above/below the 90% threshold, continue-watching query shape and `videoUrl`-leak prevention, download upsert idempotency with `expiresAt` refresh, download no-op removal, downloads list, and (fix round 1) genre-flattening on bookmarked/continue-watching movies. All failed pre-implementation as expected.

- [x] **Step 2: Implement the module, service, controller, and DTO**

Implemented `engagement.service.ts`/`controller.ts`/`module.ts` plus registration in `app.module.ts`. `addDownload` uses `prisma.download.upsert` (not `create`) on the `userId_episodeId` unique key — required beyond the brief's literal text since `Download` has `@@unique([userId, episodeId])` and a plain `create` would throw an unhandled P2002 on a repeat `PUT`, violating the same idempotent-PUT principle applied to bookmarks/watch-history; `update: { expiresAt }` refreshes the 30-day window on a repeat download-tap.

- [x] **Step 3: Run the tests**

Run: `npx jest engagement` — Expected: PASS. Verified: 13/13 pass; full suite 48/48 pass; `tsc --noEmit` and `eslint` clean on all new/modified files.

- [x] **Step 4: Verify idempotency against a live API**

```bash
curl -s -b /tmp/c.txt -X PUT localhost:3001/me/bookmarks/sathu
curl -s -b /tmp/c.txt -X PUT localhost:3001/me/bookmarks/sathu     # second call must also succeed
curl -s -b /tmp/c.txt localhost:3001/me/bookmarks | jq 'length'    # expect 1, not 2
```

Verified live against the real API + Postgres: bookmark PUT twice → `GET /me/bookmarks` returns exactly 1. Additionally verified (beyond the brief) download PUT twice on an authorized episode → `GET /me/downloads` returns exactly 1 row, second PUT returns 200 (not 500), and `expiresAt` advances on the repeat call, confirming the upsert's `update` branch actually fires; and a PUT against an unauthorized (coin-gated, unlocked) episode → `403 Forbidden`, confirming `PlaybackService.authorize` genuinely gates the write.

- [x] **Step 5: Commit**

```bash
git add apps/flick-api/src
git commit -m "feat(api): add bookmarks, watch history, and downloads endpoints"
```

Committed as `1fcfb22`. Task reviewer found spec compliance ✅ full pass on every requirement, plus one Important code-quality finding: `getBookmarks`/`getContinueWatching` returned movies without the genre-flattening `MoviesService.toDto` applies elsewhere (`movie.genres` would be `undefined` on the wire, breaking frontend code that calls `.genres.some(...)` unguarded — same bug class as Task 2.1). Fixed in round 1 (commit `fed593f`): exported `GENRES_INCLUDE` from `movies.service.ts` and added a shared `flattenMovieGenres` helper in `engagement.service.ts`, applied to both endpoints, with new tests seeding the raw join-table shape to prove the fix is real. Scoped re-review confirmed the fix resolves the finding with no regressions (13/13 engagement tests, 48/48 full suite). Two Minor findings deferred to the SDD ledger for the final whole-branch review: missing `deletedAt: null` filtering on the episode lookup in `updateProgress` and on movies returned by `getBookmarks` (soft-deleted/unpublished content could still appear in a user's bookmarks/watch-history).

---

## PHASE 3 — Frontend Wiring (Remove Fake Data)

---

### Task 3.1: Replace the localStorage auth layer with server-backed session

**Target File(s):**
- Create: `apps/flick-app/src/lib/apiClient.ts`
- Create: `apps/flick-app/src/lib/session.ts`
- Create: `apps/flick-app/src/components/AuthProvider.tsx`
- Modify: `apps/flick-app/src/lib/auth.ts` (delete the localStorage layer)
- Modify: `apps/flick-app/src/app/layout.tsx`
- Modify: `apps/flick-app/src/app/login/page.tsx`
- Modify: `apps/flick-app/src/app/register/page.tsx`
- Modify: `apps/flick-app/src/app/page.tsx`
- Modify: `apps/flick-app/src/app/home/HomeClient.tsx`

**Objective:** `isLoggedIn()` is `!!localStorage.getItem('flick_auth')` — one devtools line makes anyone "logged in". Replace it with `GET /auth/me`, which verifies the HttpOnly cookie server-side. This task **deletes** roughly 180 lines of `lib/auth.ts` rather than rewriting them; Tasks 3.2–3.4 rebind the callers.

**Interfaces:**
- **Consumes:** `GET /auth/me` (Task 1.3).
- **Produces:**
  - `apiFetch<T>(path, init?): Promise<T>` — **client-side**; always `credentials: 'include'`; throws `ApiError { status, message }` on non-2xx.
  - `apiFetchServer<T>(path, init?): Promise<T>` — **server-side** twin, in `src/lib/session.ts`. Identical contract, but forwards the incoming cookie via `next/headers` and sets `cache: 'no-store'`. Consumed by Tasks 3.3 and 3.4 from Server Components, where `credentials: 'include'` is meaningless.
  - `getSession(): Promise<AuthenticatedUser | null>` — server-only; `apiFetchServer('/auth/me')`, returning `null` on 401 instead of throwing.
  - `useAuth(): { user, loading, refresh }` — client hook.

**Implementation Details:**

The API client centralises the two things every call currently gets wrong — credentials and error shape:

```ts
// src/lib/apiClient.ts
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new ApiError(res.status, msg ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่');
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
```

Server Components cannot rely on the browser to attach the cookie — forward it explicitly:

```ts
// src/lib/session.ts   (server-only)
import { cookies } from 'next/headers';

export async function getSession(): Promise<AuthenticatedUser | null> {
  const cookieHeader = (await cookies()).toString();   // note: cookies() is async in Next 16
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  return res.ok ? res.json() : null;
}
```

Wrap `<body>` in `layout.tsx` with `<AuthProvider>`, which calls `/auth/me` on mount and exposes `{ user, loading, refresh }`.

**Delete from `lib/auth.ts`:** `getUser`, `isLoggedIn`, `getSubscription`, `subscribe`, `hasActiveSubscription`, `cancelSubscription`, `getCoins`, `addCoins`, `spendCoins`, `getWatchHistory`, `updateWatchProgress`, `getContinueWatching`, `getBookmarks`, `toggleBookmark`, `isBookmarked`, `getDownloads`, `addDownload`, `canPlayEpisode`, and all six `*_KEY` constants. Keep only `login`, `register`, and `logout`, rewritten to use `apiFetch` and to stop writing `localStorage`.

Replace the redirect-after-hydration in `HomeClient.tsx:22-27` — the current flow renders the whole page, then bounces to `/login`. Do the check in the Server Component instead:

```tsx
// src/app/home/page.tsx
const session = await getSession();
if (!session) redirect('/login');
```

**Constraints / Edge Cases:**
- `cookies()` is **async** in Next 16 — `await` it, same rule as `params`.
- `getSession()` must use `cache: 'no-store'`. Caching an auth response would serve one user's identity to another.
- Any page calling `getSession()` becomes dynamic and can no longer be statically prerendered. That is correct for `/home` and `/profile`; keep `/discover` static by *not* calling `getSession()` there.
- Delete stale `localStorage` keys on login so old fake balances do not linger in a returning user's browser.
- Do not migrate existing `localStorage` coins or subscriptions into the database — that data is client-authored and worthless.

**Verification:**

- [x] **Step 1: Prove the current bypass**

In the browser console on `/login`: `localStorage.setItem('flick_auth', '{"id":"fake"}')`, then navigate to `/home`.
Expected (before the fix): the home page renders. This is the vulnerability.

Proved without a browser: at `ed74856`, an unauthenticated `curl http://localhost:3000/home` returned `200` with the full 33 KB catalogue — the page never contacted the server about identity.

- [x] **Step 2: Implement `apiClient`, `session`, `AuthProvider`; gut `lib/auth.ts`; move the redirect server-side**

- [x] **Step 3: Confirm the bypass is closed**

Repeat Step 1. Expected: redirected to `/login`.

After: the same cookie-less `curl` returns `307 → /login` with zero home content; with a real login cookie jar it returns `200`. Two different jars render two different display names, confirming `no-store` holds.

- [x] **Step 4: Confirm a real login works and the dead code is gone**

```bash
grep -rn "localStorage" apps/flick-app/src/lib/auth.ts     # expect no matches
cd apps/flick-app && npx tsc --noEmit && npx eslint src     # expect clean
```
Then log in through the UI and confirm `/home` renders with the correct display name.

`eslint src` is clean. **`npx tsc --noEmit` aborts on a pre-existing `TS5107`** (`target: es5`, deprecated in TypeScript 6) — a config error that halts the compile before it type-checks anything, so this command as written verifies nothing on this repo. Ran `npx tsc --noEmit --ignoreDeprecations 6.0` (identical target/lib/strict) → clean. **Task 4.5 owns the `tsconfig.json` fix; until it lands, Steps 5 of Tasks 3.2–3.4 must use the same flag or they are no-ops.**

- [x] **Step 5: Commit**

```bash
git add apps/flick-app/src
git commit -m "feat(app): replace localStorage auth with server-verified session"
```

---

### Task 3.2: Wire bookmarks to real data

**Target File(s):**
- Modify: `apps/flick-app/src/app/bookmarks/page.tsx`
- Modify: `apps/flick-app/src/app/movie/[id]/MovieClient.tsx:63-66`
- Modify: `apps/flick-app/src/app/home/HomeClient.tsx:92-102`
- Modify: `apps/flick-app/src/components/MovieCard.tsx`

**Objective:** Two lies. (a) `bookmarks/page.tsx:24` falls back to `setBookmarks(data.slice(0, 5))` — a user with no bookmarks sees five arbitrary movies presented as saved. (b) The bookmark button at `MovieClient.tsx:63-66` has **no `onClick`** — it is decorative. Bind both to Task 2.6.

**Implementation Details:**

Delete the `data.slice(0, 5)` fallback outright and render the genuine empty state (`ยังไม่มีรายการที่บันทึกไว้`), which already exists at line 53.

Fetch from the real endpoint:

```tsx
const movies = await apiFetch<Movie[]>('/me/bookmarks');
```

Make the button functional with optimistic UI and rollback:

```tsx
const [bookmarked, setBookmarked] = useState(initialBookmarked);

const toggle = async () => {
  const next = !bookmarked;
  setBookmarked(next);                       // optimistic
  try {
    await apiFetch(`/me/bookmarks/${movie.id}`, { method: next ? 'PUT' : 'DELETE' });
  } catch (err) {
    setBookmarked(!next);                    // roll back
    if (err instanceof ApiError && err.status === 401) router.push('/login');
  }
};
```

In `HomeClient.tsx`, replace the "My List" skeleton cards (lines 97-101) with the real empty state. Three permanently-animating skeletons read as "broken", not "empty":

```tsx
{bookmarks.length > 0
  ? bookmarks.map((m) => <MovieCard key={m.id} movie={m} size="medium" showBookmark />)
  : <p className={styles.emptyHint}>ยังไม่มีรายการที่บันทึกไว้</p>}
```

**Constraints / Edge Cases:**
- The `showBookmark` prop on `MovieCard` currently renders a static badge. It must reflect real state, not "this list happens to be the bookmarks list".
- Roll back optimistic state on failure — silently diverging from the server is worse than a brief flicker.
- `401` from any engagement call means the session expired: redirect to `/login`, do not show a generic error.
- Do not add a bookmark button to `MovieCard`; the card is a `<Link>`, and a nested interactive control breaks keyboard navigation.

**Verification:**

- [x] **Step 1: Prove the fake fallback**

Log in as a user with zero bookmarks and open `/bookmarks`.
Expected (before): five movies displayed. After: the empty state.

The `data.slice(0, 5)` fallback was already removed by Task 3.1's minimal-compile pass; this task wires the real fetch behind it.

- [x] **Step 2: Implement the real fetch, the toggle handler, and the empty states**

Also closed two gaps the brief didn't specify: `/bookmarks` gained a server-side `getSession()` guard (Server Component `page.tsx` + new `BookmarksClient.tsx`, mirroring `/home`), and `/movie/[id]` gained a soft server-side bookmark-status check that fails to `false` on a 401 but rethrows real faults — while staying public for anonymous visitors.

- [x] **Step 3: Verify the round trip**

Bookmark a movie on `/movie/sathu`, then:
```bash
curl -s -b /tmp/c.txt localhost:3001/me/bookmarks | jq '.[].id'   # expect ["sathu"]
```
Reload `/bookmarks` — the movie appears. Un-bookmark it; it disappears and the API returns `[]`.

- [x] **Step 4: Verify rollback**

Stop the API, click the bookmark button, and confirm the icon reverts to its previous state rather than staying toggled.

- [x] **Step 5: Commit**

```bash
git add apps/flick-app/src
git commit -m "feat(app): wire bookmarks to the API and remove the fake fallback list"
```

**Fix round 1** closed 2 Important review findings: `/home` and `/movie/[id]` each shared one `try`/`Promise.all` between their pre-existing content fetch and the new bookmarks fetch, so a bookmarks-only fault took the whole page down instead of degrading just the affected section. Isolated into separate `try`/`catch` blocks (commit `1ac700a`); re-review confirmed both ADDRESSED with no regressions.

---

### Task 3.3: Wire profile, subscription, and wallet

**Target File(s):**
- Modify: `apps/flick-app/src/app/profile/page.tsx`
- Modify: `apps/flick-app/src/app/subscribe/page.tsx`

**Objective:** `profile/page.tsx:29-31` hardcodes `ชื่อผู้ใช้` / `@username` / `user@example.com` and line 39 hardcodes `พรีเมียมรายเดือน` for every visitor, subscribed or not. `subscribe/page.tsx` duplicates all three plan cards in JSX (lines 63-104) even though `GET /plans` already returns `SUBSCRIPTION_PLANS` — only the coin packs are read from the API. Bind both to real data.

**Implementation Details:**

Convert `profile/page.tsx` to a Server Component that reads the session and the two entitlement endpoints in parallel:

```tsx
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [subscription, wallet] = await Promise.all([
    apiFetchServer<Subscription | null>('/subscriptions/me'),
    apiFetchServer<{ balance: number }>('/wallet'),
  ]);
  // render session.displayName, session.email, subscription?.planType ?? 'ฟรี', wallet.balance
}
```

Keep the logout button in a small client child so the page itself stays a Server Component.

In `subscribe/page.tsx`, render the subscription cards from `data.subscriptions` — the same `/plans` response already being fetched for coins. Delete the three hardcoded `<div className={styles.planCard}>` blocks. This removes the drift that produced the `'vip-weekly'` bug in the first place.

Route the two actions to the server:

```tsx
const handleSubscribe = async (planId: string) => {
  try {
    await apiFetch('/subscriptions', { method: 'POST', body: JSON.stringify({ planId }) });
    router.push('/home'); router.refresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return router.push('/login');
    setError(err instanceof ApiError ? err.message : 'สมัครสมาชิกไม่สำเร็จ');
  }
};
```

Delete `handleBuyCoins`'s call to the removed `addCoins()`. There is no payment gateway, so the coin-pack card must **not** claim a purchase succeeded. Disable the cards and show `เร็ว ๆ นี้` ("coming soon").

**Constraints / Edge Cases:**
- **Do not fake a coin purchase.** The current `setToast('ซื้อสำเร็จ!')` after a free `addCoins()` is exactly the behaviour being removed; reproducing it against the API would corrupt the ledger.
- `router.refresh()` after subscribing — otherwise the cached Server Component still shows the old status.
- The free plan's button navigates to `/home` and must not POST.
- Profile settings rows (`ตั้งค่าบัญชี`, `การแจ้งเตือน`, …) are non-functional. Out of scope, but make them visibly disabled rather than looking tappable.
- `plans.config.ts` `id`s must match the `PaidPlanId` union from Task 2.4; if they diverge, fix the config, not the frontend.

**Verification:**

- [x] **Step 1: Prove the hardcoding**

Run: `grep -n "user@example.com\|พรีเมียมรายเดือน" apps/flick-app/src/app/profile/page.tsx`
Expected: matches at lines 31 and 39.

- [x] **Step 2: Implement the server-rendered profile and API-driven plan cards**

Also closed two gaps beyond the brief: `/subscribe` gained a server-side `getSession()` guard (split into a Server Component `page.tsx` + new `SubscribeClient.tsx`, mirroring `/bookmarks`), and a new `LogoutButton.tsx` calls `useAuth().refresh()` before navigating away, closing the stale-client-session gap Task 3.1 flagged as this task's job.

- [x] **Step 3: Verify real data renders**

Log in as a user with **no** subscription and open `/profile`.
Expected: the real email, and status `ฟรี` — not `พรีเมียมรายเดือน`.

- [x] **Step 4: Verify subscribing updates the profile**

Subscribe to `weekly` on `/subscribe`, return to `/profile`.
Expected: status shows the weekly plan; `curl -s -b /tmp/c.txt localhost:3001/subscriptions/me | jq .planType` returns `"weekly"`.

**Note:** coin top-ups remain permanently disabled per this task's own Constraints (no payment gateway exists anywhere in this plan) — verified with no purchase path reachable anywhere in `src/`. Spending coins to unlock an episode is Task 3.4's scope, not this task's; not verified here.

- [x] **Step 5: Commit**

```bash
git add apps/flick-app/src
git commit -m "feat(app): render profile and plans from real subscription and wallet data"
```

---

### Task 3.4: Wire downloads, continue-watching, and the player gate

**Target File(s):**
- Modify: `apps/flick-app/src/app/downloads/page.tsx`
- Modify: `apps/flick-app/src/app/home/HomeClient.tsx:64-83`
- Modify: `apps/flick-app/src/app/player/[id]/page.tsx`
- Modify: `apps/flick-app/src/app/movie/[id]/MovieClient.tsx:110-126`

**Objective:** Three more fictions. (a) `downloads/page.tsx:26-31` maps the first three movies into fake download items with a hardcoded `'ตอนที่ 1'` and `'10 นาที'`, ignoring `getDownloads()` entirely. (b) Continue-watching renders permanent skeletons because `updateWatchProgress` is never called. (c) `player/[id]/page.tsx:31-37` has the subscription guard **commented out** next to a dead `const isLocked = true`, and imports `hasActiveSubscription` without using it — so premium episodes are freely playable.

**Implementation Details:**

Downloads: fetch `GET /me/downloads` and render the real empty state. Delete the `data.slice(0, 3)` mapping and the `DownloadItem` interface's invented `epTitle`/`duration`/`desc` fields; use the real `Episode` shape. Replace `key={idx}` with `key={item.id}`.

Continue-watching: fetch `GET /me/continue-watching` and render a progress bar from `progressSeconds / (durationMinutes * 60)`. Replace the three skeletons with `ยังไม่มีรายการที่ดูค้างไว้`.

Player gate — call the authorization endpoint before playing:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const auth = await apiFetch<PlaybackAuthorization>(`/playback/${episodeId}/authorize`);
      if (cancelled) return;
      if (auth.allowed) setVideoUrl(auth.videoUrl);
      else setGate(auth);                       // drives the existing subscription modal
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    }
  })();
  return () => { cancelled = true; };
}, [episodeId, router]);
```

Delete `const isLocked = true`, the commented block, and the unused `hasActiveSubscription` import. The existing `subscriptionModal` JSX (lines 170-183) becomes the real gate, with `coins_required` offering an "unlock with coins" action that calls `POST /wallet/spend` then re-runs authorization.

Episode rows in `MovieClient.tsx:112` currently derive lock state from `ep.coinCost > 0`. That is a reasonable *display* hint — keep it, but the play action must still go through `/playback/:id/authorize`. Never gate on client-side cost alone.

**Constraints / Edge Cases:**
- Guard the async effect with a `cancelled` flag; the current code has no cleanup and will set state after unmount.
- Report watch progress on a throttle (every ~10s and on unmount), not per tick — the existing `setInterval` fires every 100ms and would flood the API.
- Offline playback is not implemented. A "download" is a database record only; label the screen accordingly and do not imply local media.
- After a successful coin unlock, re-call `authorize` rather than optimistically setting `videoUrl` — the server is the authority.

**Verification:**

- [ ] **Step 1: Prove the fakes**

```bash
grep -n "slice(0, 3)" apps/flick-app/src/app/downloads/page.tsx     # the fake list
grep -n "const isLocked = true" apps/flick-app/src/app/player/\[id\]/page.tsx
```
Expected: both match.

- [ ] **Step 2: Implement the three real fetches and the player gate**

- [ ] **Step 3: Verify premium content is gated**

As a user with no subscription and zero coins, open the player for a premium episode (`coinCost > 0`).
Expected: the subscription/coins modal appears; playback does not start; no `videoUrl` is present anywhere in the page source.

- [ ] **Step 4: Verify the unlock path**

Credit the test user coins directly in `psql` (via a `UserCoin` row plus a matching `coinBalance`), retry the unlock, and confirm playback becomes available and the balance decreases by exactly `coinCost`.

- [ ] **Step 5: Verify dead code is gone**

Run: `cd apps/flick-app && npx eslint src && npx tsc --noEmit` — Expected: clean, no unused-import warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/flick-app/src
git commit -m "feat(app): wire downloads and continue-watching, and gate playback server-side"
```

---

## PHASE 4 — Ops, Security, and Polish

---

### Task 4.1: Fail-fast configuration and environment-driven CORS

**Target File(s):**
- Create: `apps/flick-api/src/common/config.validation.ts`
- Modify: `apps/flick-api/src/app.module.ts:12`
- Modify: `apps/flick-api/src/auth/auth.module.ts:10-16`
- Modify: `apps/flick-api/src/main.ts:12-15`
- Create: `apps/flick-api/.env.example`
- Create: `apps/flick-app/.env.example`

**Objective:** `auth.module.ts:12-14` falls back to a hardcoded secret — `'super-secret-flick-key-for-dev-only-do-not-use-in-prod'` — **committed to this repository**. If `JWT_SECRET` is unset in production, every token is signed with a publicly known key and anyone can forge a session. Separately, `main.ts:13` hardcodes `origin: 'http://localhost:3000'`, so CORS breaks on deploy.

**Implementation Details:**

Validate at boot so a misconfigured deploy fails loudly instead of running insecurely:

```ts
// src/common/config.validation.ts
export function validateEnv(config: Record<string, unknown>) {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGIN'] as const;
  const missing = required.filter((k) => !config[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (String(config.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return config;
}
```

Wire it: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`.

Convert `JwtModule.register` to `registerAsync` with `ConfigService`, and **delete the `||` fallback**:

```ts
secret: config.getOrThrow<string>('JWT_SECRET'),
signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
```

CORS from config, supporting a comma-separated list:

```ts
app.enableCors({
  origin: config.getOrThrow<string>('CORS_ORIGIN').split(',').map((s) => s.trim()),
  credentials: true,
});
```

Write both `.env.example` files documenting `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `REDIS_URL`, `PORT`, and `NEXT_PUBLIC_API_URL`.

**Constraints / Edge Cases:**
- `.gitignore` already covers `.env*` — verify `.env.example` is force-added (`git add -f`) or narrow the ignore rule, otherwise the example is silently untracked.
- **Rotating `JWT_SECRET` invalidates every live session.** Note it in the README; this is correct behaviour, not a bug.
- Never log the secret, including in the validation error.
- `credentials: true` with `origin: '*'` is rejected by browsers — the explicit list is required, not optional.

**Verification:**

- [ ] **Step 1: Prove the fallback exists**

Run: `grep -n "super-secret-flick-key" apps/flick-api/src/auth/auth.module.ts` — Expected: line 14.

- [ ] **Step 2: Implement validation, async JWT config, and env-driven CORS**

- [ ] **Step 3: Verify it fails loudly**

Run: `cd apps/flick-api && env -u JWT_SECRET npm run start`
Expected: the process exits with `Missing required environment variables: JWT_SECRET`.

- [ ] **Step 4: Verify the secret is gone and a short one is rejected**

```bash
grep -rn "super-secret-flick-key" apps/flick-api/src/     # expect no matches
JWT_SECRET=short npm run start                            # expect the length error
```

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api apps/flick-app/.env.example
git commit -m "fix(api): fail fast on missing config and remove the committed JWT fallback secret"
```

---

### Task 4.2: Prisma exception filter and API hardening

**Target File(s):**
- Create: `apps/flick-api/src/common/prisma-exception.filter.ts`
- Modify: `apps/flick-api/src/main.ts`
- Modify: `apps/flick-api/src/prisma.service.ts`
- Modify: `apps/flick-api/src/app.controller.ts`
- Modify: `apps/flick-api/src/auth/auth.controller.ts`
- Modify: `apps/flick-api/package.json`
- Test: `apps/flick-api/src/common/prisma-exception.filter.spec.ts`

**Objective:** Five ops gaps: registering with a duplicate phone returns a `500` (unhandled `P2002`) instead of a `400`; there is no rate limiting on login or register, so credentials can be brute-forced; no `helmet`; the cookie's 7-day `maxAge` (`auth.controller.ts:24`) outlives the 1-day token (`auth.module.ts:15`), leaving users apparently logged in for six days after their token dies; and `PrismaService` never disconnects its pool.

**Implementation Details:**

Map the Prisma error codes that reach users:

```ts
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, message } = this.map(err);
    res.status(status).json({ statusCode: status, message });
  }

  private map(err: Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': return { status: 409, message: 'ข้อมูลนี้ถูกใช้งานแล้ว' };  // unique violation
      case 'P2025': return { status: 404, message: 'ไม่พบข้อมูลที่ต้องการ' };
      case 'P2003': return { status: 400, message: 'ข้อมูลอ้างอิงไม่ถูกต้อง' };
      default:      return { status: 500, message: 'เกิดข้อผิดพลาดของระบบ' };
    }
  }
}
```

Register globally: `app.useGlobalFilters(new PrismaExceptionFilter())`.

Add rate limiting (`npm i @nestjs/throttler`): a global default of 100 requests/minute, with a tight override on the credential endpoints:

```ts
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Post('login')
```

Add `helmet` (`npm i helmet`) via `app.use(helmet())`.

**Align the cookie and token lifetimes.** Derive both from one config value so they cannot drift again:

```ts
const maxAge = ms(config.getOrThrow('JWT_EXPIRES_IN'));  // same value the token uses
res.cookie('access_token', token, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge });
```

Add `onModuleDestroy` to `PrismaService` calling `this.$disconnect()`, and `app.enableShutdownHooks()` in `main.ts`.

Replace `AppController.getHello`'s `'Hello World!'` with `GET /health` returning `{ status: 'ok', db: 'up' }` after a `SELECT 1`.

**Constraints / Edge Cases:**
- The filter must not leak `err.meta` (which names the conflicting column) to the client. Log it server-side only.
- Login stays deliberately generic (`อีเมลหรือรหัสผ่านไม่ถูกต้อง`) — a `409` from the filter must never reach the login path, or it becomes a user-enumeration oracle. Registration already returns a `400` explicitly before hitting Prisma; the filter is the backstop for the race.
- Throttling is per-IP and in-memory by default; behind a proxy set `app.set('trust proxy', 1)` or every client shares one bucket.
- `test/app.e2e-spec.ts:22` asserts `'Hello World!'` — update it when replacing the route.

**Verification:**

- [ ] **Step 1: Prove the 500**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3001/auth/register \
  -H 'content-type: application/json' \
  -d '{"displayName":"A","email":"a@b.com","phone":"0800000000","password":"password123"}'
# run twice with different emails but the SAME phone — second call returns 500
```

- [ ] **Step 2: Write the failing filter test**

```ts
it('maps a unique-constraint violation to 409 without leaking the column', () => {
  const err = new Prisma.PrismaClientKnownRequestError('x', {
    code: 'P2002', clientVersion: '7', meta: { target: ['phone'] },
  });
  filter.catch(err, host);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('phone');
});
```

Run: `npx jest prisma-exception` — Expected: FAIL.

- [ ] **Step 3: Implement the filter, throttler, helmet, TTL alignment, shutdown hooks, and health route**

- [ ] **Step 4: Run the tests and re-check the duplicate**

```bash
npx jest
# repeat the Step 1 duplicate-phone request — expect 409, not 500
```

- [ ] **Step 5: Verify rate limiting and headers**

```bash
for i in $(seq 1 7); do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3001/auth/login \
    -H 'content-type: application/json' -d '{"email":"a@b.com","password":"wrongpassword"}'
done; echo
# expect: 401 401 401 401 401 429 429
curl -sI localhost:3001/health | grep -i "x-frame-options\|strict-transport"   # helmet present
```

- [ ] **Step 6: Commit**

```bash
git add apps/flick-api
git commit -m "feat(api): add Prisma exception filter, rate limiting, helmet, and graceful shutdown"
```

---

### Task 4.3: Accessibility fixes

**Target File(s):**
- Modify: `apps/flick-app/src/app/layout.tsx:15`
- Modify: `apps/flick-app/src/app/movie/[id]/MovieClient.tsx:92-107`
- Modify: `apps/flick-app/src/app/movie/[id]/InfoModal.tsx`
- Modify: `apps/flick-app/src/app/player/[id]/page.tsx:132-167`
- Modify: `apps/flick-app/src/app/page.tsx:11-21`

**Objective:** Four defects. `layout.tsx:15` sets `maximum-scale=1, user-scalable=no`, which blocks pinch-zoom — a **WCAG 2.1 SC 1.4.4 failure** and a real barrier for low-vision users. The season dropdown items at `MovieClient.tsx:95-104` are `<div onClick>` — not focusable, not keyboard-activatable. Neither modal handles `Escape` or traps focus. The splash screen burns a hard 3 seconds before routing.

**Implementation Details:**

Remove the zoom lock:

```tsx
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

Convert dropdown items to real buttons — this fixes focus, `Enter`/`Space` activation, and screen-reader role in one change:

```tsx
<button
  type="button"
  role="option"
  aria-selected={s.seasonNumber === selectedSeason}
  className={styles.dropdownItem}
  onClick={() => { setSelectedSeason(s.seasonNumber); setSeasonDropdownOpen(false); }}
>
  ซีซั่น {s.seasonNumber}
</button>
```

Add `aria-expanded` and `aria-haspopup="listbox"` to the trigger, and `role="listbox"` to the menu.

Extract one shared modal hook so both `InfoModal` and the player settings overlay behave the same:

```tsx
function useModalDismiss(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';       // stop background scroll
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
}
```

Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` to both, and move focus to the close button on open.

Splash: route as soon as the session resolves instead of on a fixed 3s timer. Keep a short minimum (~300ms) only to avoid a jarring flash.

**Constraints / Edge Cases:**
- `user-scalable=no` is sometimes added to stop iOS zooming on input focus. The correct fix is a `≥16px` font-size on inputs, not disabling zoom — check `login/page.module.css` and `register/page.module.css` and raise the input font size if needed.
- Restore `document.body.style.overflow` in the cleanup, or a crash mid-modal leaves the page unscrollable.
- Converting `<div>` to `<button>` inherits UA button styles — verify `.dropdownItem` still resets `background`, `border`, and `font`.
- Emoji-only buttons (`👍`, `📤`, `🔖`) already have `aria-label`s. Keep them; do not regress.

**Verification:**

- [ ] **Step 1: Confirm the violations**

```bash
grep -n "user-scalable" apps/flick-app/src/app/layout.tsx
grep -n "div .*onClick" apps/flick-app/src/app/movie/\[id\]/MovieClient.tsx
```
Expected: both match.

- [ ] **Step 2: Apply the viewport, button, and modal changes**

- [ ] **Step 3: Verify by keyboard only**

With the mouse unused: `Tab` to the season dropdown, press `Enter`, `Tab` through the options, press `Enter` to select. Open the info modal and press `Escape` to close.
Expected: every step works.

- [ ] **Step 4: Verify zoom and run an automated audit**

Pinch-zoom on a mobile viewport (or set device emulation in devtools) — the page must zoom. Then:
```bash
npx @axe-core/cli http://localhost:3000/movie/sathu --exit
```
Expected: no critical or serious violations.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app/src
git commit -m "fix(app): restore pinch-zoom, make dropdowns keyboard-accessible, add modal dismiss"
```

---

### Task 4.4: Replace the simulated player with real HLS playback

**Target File(s):**
- Modify: `apps/flick-app/src/app/player/[id]/page.tsx`
- Modify: `apps/flick-app/package.json`

**Objective:** The player is a `setInterval` that increments a number 0.5 at a time over a poster image (`page.tsx:40-54`, `80-89`). There is no `<video>` element. Replace it with real HLS playback using the authorized `videoUrl` from Task 3.4.

**Implementation Details:**

Install `hls.js` (`npm i hls.js`). Safari plays HLS natively; everything else needs the polyfill:

```tsx
useEffect(() => {
  const video = videoRef.current;
  if (!video || !videoUrl) return;

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = videoUrl;                                  // Safari / iOS
    return;
  }
  let hls: Hls | undefined;
  void import('hls.js').then(({ default: Hls }) => {
    if (!Hls.isSupported()) { setError('เบราว์เซอร์นี้ไม่รองรับการเล่นวิดีโอ'); return; }
    hls = new Hls();
    hls.loadSource(videoUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setError('เกิดข้อผิดพลาดในการเล่นวิดีโอ'); });
  });
  return () => hls?.destroy();
}, [videoUrl]);
```

Replace the simulated controls: `progress` comes from the `timeupdate` event, the seek bar sets `video.currentTime`, and play/pause calls `video.play()` / `video.pause()`. Delete the entire `setInterval` effect.

Give the `<video>` a `poster={movie.posterUrl}` so the current visual is preserved during load, and wire watch-progress reporting (Task 3.4) to `timeupdate`, throttled to every 10 seconds.

Make the settings overlay honest: quality and audio-track options must come from `hls.levels` and `hls.audioTracks`, or be removed. A menu of speeds and subtitle languages that does nothing is the same fiction this plan is removing everywhere else. Playback speed can be implemented immediately via `video.playbackRate`.

**Constraints / Edge Cases:**
- Dynamic-`import` `hls.js` — it is large and Safari never needs it.
- `video.play()` returns a Promise that rejects under autoplay policy. Catch it and keep the play button visible; do not let it become an unhandled rejection.
- Always `hls.destroy()` on unmount or the buffer keeps downloading after navigation.
- The seed has `videoUrl: null` on every episode. Task 2.5 already returns a `503` for that case — verify the player surfaces it as `ตอนนี้ยังไม่พร้อมรับชม` rather than a blank screen.
- Do not add DRM. Out of scope.

**Verification:**

- [ ] **Step 1: Confirm the simulation**

Run: `grep -n "setInterval\|<video" apps/flick-app/src/app/player/\[id\]/page.tsx`
Expected: `setInterval` present, no `<video>` element.

- [ ] **Step 2: Implement the `<video>` element, HLS attachment, and real controls**

- [ ] **Step 3: Verify playback against a public test stream**

Temporarily set one episode's `videoUrl` to `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` in the database, then open its player page.
Expected: video plays; the progress bar advances with playback; seeking works; pause works.

- [ ] **Step 4: Verify the null-URL path and cleanup**

Set `videoUrl` back to `null` and reload — expect the "not available" message, not a blank player. Navigate away mid-playback and confirm in the Network tab that segment requests stop.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-app
git commit -m "feat(app): replace the simulated player with real HLS playback"
```

---

### Task 4.5: Build and repository hygiene

**Target File(s):**
- Modify: `apps/flick-app/tsconfig.json:3`
- Delete: `apps/flick-app/jsconfig.json`
- Modify: `apps/flick-app/package.json`
- Modify: `apps/flick-app/next.config.mjs`
- Modify: `apps/flick-app/src/components/MovieCard.tsx:25`
- Modify: `.gitignore`
- Delete: 23 stray `.jpg` files at the repository root

**Objective:** Accumulated cruft: `target: "es5"` is deprecated in TypeScript 6 (it emits an error today: `TS5107`) and bloats output for a React 19 app; `jsconfig.json` and `tsconfig.json` both declare `paths`; Tailwind is installed but `postcss.config.mjs` has `plugins: {}` and no `.tsx` uses it; `next/image` runs with `unoptimized={true}` while `remotePatterns: []` would throw on any remote poster; 23 `.jpg` files sit tracked at the repo root; and Next warns about competing lockfiles (it selected `/Users/macintosh/package-lock.json` as the workspace root).

**Implementation Details:**

`tsconfig.json`: `"target": "ES2022"`. Verify with `npx tsc --noEmit` that `TS5107` is gone.

**✅ ALREADY DONE — pulled forward to unblock Phase 3 (commit `cf79505`).** `TS5107` was not a warning: a `tsconfig.json` error aborts compilation before any type-checking, so `npx tsc --noEmit` — the Step-5 verification command in Tasks 3.1–3.4 — was silently verifying nothing. Fixed after Task 3.1 so the remaining Phase 3 tasks get a real typecheck. Confirmed genuine afterwards: 26 source files traversed, and a deliberately planted type error was caught. The rest of Task 4.5 is untouched.

Delete `jsconfig.json` — `tsconfig.json` already defines the same `@/*` path mapping, and two config files is a drift hazard.

Remove `tailwindcss` and `@tailwindcss/postcss` from `devDependencies`. `AI_STATUS.md` states "CSS Modules (No Tailwind)"; make the manifest agree.

Images: drop `unoptimized={true}` from `MovieCard.tsx:25` and configure the real host:

```js
images: { remotePatterns: [{ protocol: 'https', hostname: process.env.NEXT_PUBLIC_IMAGE_HOST ?? 'localhost' }] },
```

If posters stay local under `/public/posters/`, no `remotePatterns` entry is needed and optimization works unchanged.

Silence the workspace-root warning by setting `turbopack.root` in `next.config.mjs` to the monorepo root.

Remove the 23 root `.jpg` files (`git rm`) — they are unreferenced Facebook-export images; the app's real posters live in `apps/flick-app/public/posters/`. Add `*.MOV` to `.gitignore` (two ~28MB files are currently untracked in the working tree).

**Constraints / Edge Cases:**
- **Verify the `.jpg` files are truly unreferenced before deleting:** `grep -rn "749681060\|750737857" --include=*.tsx --include=*.css apps/`. Delete only on zero matches.
- Removing `unoptimized` changes rendering — re-check every poster still displays, especially in `MovieCard`'s `fill` layout.
- `target: ES2022` may surface previously-masked type errors. Fix them; do not revert the target.
- The `.MOV` files are untracked — `.gitignore` prevents future accidents but does not remove them from disk. Leave the working-tree files alone.

**Verification:**

- [ ] **Step 1: Capture the current warnings**

```bash
cd apps/flick-app && npx tsc --noEmit          # expect TS5107
npx next build 2>&1 | grep -i "workspace root"  # expect the lockfile warning
git ls-files | grep -c "\.jpg$"                 # expect 23
```

- [ ] **Step 2: Apply the target bump, config deletions, dependency removals, and image config**

- [ ] **Step 3: Verify clean typecheck, lint, and build**

```bash
cd apps/flick-app
npx tsc --noEmit          # expect no output
npx eslint src            # expect no output
npx next build            # expect success, no workspace-root warning
```

- [ ] **Step 4: Verify the repo is tidy**

```bash
git ls-files | grep -c "\.jpg$"                    # expect 0
grep -rn "tailwind" apps/flick-app/package.json    # expect no matches
ls apps/flick-app/jsconfig.json 2>&1               # expect "No such file"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(app): modernize tsconfig, drop unused Tailwind, and remove stray root assets"
```

---

### Task 4.6: End-to-end test suite and CI gate

**Target File(s):**
- Modify: `apps/flick-api/test/app.e2e-spec.ts`
- Create: `apps/flick-api/test/auth.e2e-spec.ts`
- Create: `apps/flick-api/test/entitlement.e2e-spec.ts`
- Create: `.github/workflows/ci.yml`

**Objective:** Lock in the security properties this plan established so a later change cannot silently undo them. The existing e2e suite asserts `'Hello World!'` and nothing else. Without a CI gate, the `videoUrl` leak, the auth bypass, and the draft-movie leak are all one refactor away from returning.

**Implementation Details:**

Rewrite `app.e2e-spec.ts` for the `/health` route from Task 4.2. Then write the two suites that encode the invariants:

```ts
// test/auth.e2e-spec.ts
it('rejects a protected route without a cookie', () =>
  request(app.getHttpServer()).get('/auth/me').expect(401));

it('accepts a protected route with the login cookie', async () => {
  const login = await request(app.getHttpServer()).post('/auth/login')
    .send({ email: SEED_EMAIL, password: SEED_PASSWORD }).expect(200);
  await request(app.getHttpServer()).get('/auth/me')
    .set('Cookie', login.headers['set-cookie']).expect(200);
});

it('never returns the access token in a response body', async () => {
  const res = await request(app.getHttpServer()).post('/auth/login')
    .send({ email: SEED_EMAIL, password: SEED_PASSWORD });
  expect(JSON.stringify(res.body)).not.toContain('access_token');
});
```

```ts
// test/entitlement.e2e-spec.ts
it('never exposes videoUrl through the movie list', async () => {
  const res = await request(app.getHttpServer()).get('/movies').expect(200);
  expect(JSON.stringify(res.body)).not.toContain('videoUrl');
});

it('denies a premium episode to a user with no subscription and no coins', async () => {
  const res = await request(app.getHttpServer())
    .get(`/playback/${PREMIUM_EPISODE_ID}/authorize`)
    .set('Cookie', freeUserCookie).expect(200);
  expect(res.body.allowed).toBe(false);
  expect(res.body.videoUrl).toBeUndefined();
});

it('does not serve draft movies publicly', async () => {
  await request(app.getHttpServer()).get(`/movies/${DRAFT_MOVIE_ID}`).expect(404);
});
```

Add a `DRAFT` movie and a premium episode to `seed.ts` specifically so these assertions have something to test against.

CI workflow: Postgres 16 and Redis 7 service containers, then `npm ci` → `prisma migrate deploy` → `prisma db seed` → `npm run lint --workspaces` → `npm run test --workspace=flick-api` → `npm run test:e2e --workspace=flick-api` → `npm run build --workspaces`.

**Constraints / Edge Cases:**
- `test/jest-e2e.json` is a separate config from the `jest` block in `package.json` — e2e specs will not run under `npx jest`. Use `npm run test:e2e`.
- E2e tests need a real database. Reset it between suites via `migrate reset --force` against the **CI** database only, never a developer's local one.
- `test/app.e2e-spec.ts` uses `beforeEach` to build the whole Nest app for every test — slow. Switch to `beforeAll` for the new suites.
- **The build must run with the API unavailable and still be caught.** Today `next build` succeeds while baking fetch failures into static HTML (`/home` baked its error message; `/discover` baked an empty list). In CI, start the API before building the frontend so this cannot ship silently.

**Verification:**

- [ ] **Step 1: Confirm the current e2e coverage**

Run: `grep -c "it(" apps/flick-api/test/app.e2e-spec.ts` — Expected: `1`.

- [ ] **Step 2: Write the three suites and the CI workflow**

- [ ] **Step 3: Run e2e locally against a test database**

Run: `cd apps/flick-api && npm run test:e2e`
Expected: all suites pass.

- [ ] **Step 4: Prove the tests actually catch regressions**

Temporarily remove the `status: 'PUBLISHED'` filter from `MoviesService.findAll`, re-run `npm run test:e2e`.
Expected: the draft-movie test **fails**. Restore the filter and confirm it passes again. A test that cannot fail is not a test.

- [ ] **Step 5: Commit**

```bash
git add apps/flick-api/test .github
git commit -m "test(api): add auth and entitlement e2e suites with a CI gate"
```

---

## Definition of Done

All 14 review findings are closed when:

| # | Finding | Closed by |
|---|---|---|
| 1 | Next 16 `params` Promise | Task 1.2 |
| 2 | No JWT guard; localStorage auth | Tasks 1.3, 3.1 |
| 3 | localStorage monetization | Tasks 2.3, 2.4, 2.5, 3.3 |
| 4 | `POST /movies` 500 on genre | Task 2.1 |
| 5 | Genre filtering broken | Task 2.1 |
| 6 | `findAll` returns drafts | Task 1.4 |
| 7 | In-memory cache, not Redis | Task 2.2 |
| 8 | Dead code in `lib/auth.ts` | Tasks 2.6, 3.1, 3.2, 3.4 |
| 9 | Fake UI data | Tasks 3.2, 3.3, 3.4 |
| 10 | Weekly plan grants a month | Task 2.4 |
| 11 | Broken unit tests | Task 1.1 |
| 12 | No migrations | Task 1.5 |
| 13 | Ops/security gaps | Tasks 4.1, 4.2 |
| 14 | Accessibility and fake player | Tasks 4.3, 4.4 |

**Final gate:** `npm run lint --workspaces` clean · `npm run build --workspaces` clean · `npm run test --workspace=flick-api` green · `npm run test:e2e --workspace=flick-api` green · zero `localStorage` references outside non-authoritative UI cache · `curl -s localhost:3001/movies | grep -c videoUrl` returns `0`.
