import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { FakeOAuthProviderAdapter } from './../src/auth/oauth/adapters/fake-provider.adapter';

describe('OAuth social login (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Registered before the module tree compiles: OAuthModule's registry
    // factory reads OAUTH_PROVIDERS off ConfigService at construction time.
    // The fake adapter needs no credentials and is refused only in
    // production (NODE_ENV=test here), so no other env var is required.
    process.env.OAUTH_PROVIDERS = 'fake';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    delete process.env.OAUTH_PROVIDERS;
    await app.close();
  });

  /** Cleans any identity/user left by a prior run sharing this providerAccountId. */
  async function cleanup(providerAccountId: string) {
    const identity = await prisma.identity.findFirst({
      where: { providerAccountId },
    });
    if (identity) {
      await prisma.identity.deleteMany({ where: { id: identity.id } });
      await prisma.user.deleteMany({ where: { id: identity.userId } });
    }
  }

  const signIn = (profile: Record<string, unknown>): Promise<Response> =>
    request(app.getHttpServer())
      .post('/auth/oauth/nonce')
      .send({ provider: 'google' })
      .expect(200)
      .then((issued: Response) => {
        const nonce = (issued.body as { nonce: string }).nonce;
        return request(app.getHttpServer())
          .post('/auth/oauth/verify')
          .send({
            provider: 'google',
            nonce,
            idToken: FakeOAuthProviderAdapter.mint(profile as never, nonce),
          });
      });

  // `.expect()` belongs to supertest's *pending* Test, not to the Response it
  // resolves to — and `signIn` returns a promise that has already settled by
  // the time a test sees it (the chain flattens the inner Test). Asserting on
  // the {status, body} pair keeps the response body in the failure output,
  // which a bare `expect(res.status)` would throw away.
  const expectStatus = (res: Response, status: number): Response => {
    expect({ status: res.status, body: res.body as unknown }).toMatchObject({
      status,
    });
    return res;
  };

  it('creates a user and sets an HttpOnly session cookie', async () => {
    await cleanup('sub_e2e_create');

    const res = expectStatus(
      await signIn({
        providerAccountId: 'sub_e2e_create',
        email: 'e2e-oauth-create@flick.test',
        emailVerified: true,
        displayName: 'E2E',
        avatarUrl: null,
      }),
      200,
    );

    expect(res.headers['set-cookie'][0]).toContain('access_token=');
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(JSON.stringify(res.body)).not.toContain('access_token');

    await cleanup('sub_e2e_create');
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
        {
          providerAccountId: 'sub_e2e_replay',
          email: null,
          emailVerified: false,
          displayName: null,
          avatarUrl: null,
        },
        nonce,
      ),
    };

    await request(app.getHttpServer())
      .post('/auth/oauth/verify')
      .send(body)
      .expect(200);
    // A captured request must be worth nothing the second time.
    await request(app.getHttpServer())
      .post('/auth/oauth/verify')
      .send(body)
      .expect(400);

    await cleanup('sub_e2e_replay');
  });

  it('logs the same provider account back into the same user', async () => {
    await cleanup('sub_e2e_stable');
    const profile = {
      providerAccountId: 'sub_e2e_stable',
      email: 'e2e-oauth-stable@flick.test',
      emailVerified: true,
      displayName: 'Stable',
      avatarUrl: null,
    };
    const first = expectStatus(await signIn(profile), 200);
    const second = expectStatus(await signIn(profile), 200);

    const idOf = async (res: Response) => {
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', res.headers['set-cookie'] as unknown as string[])
        .expect(200);
      return (me.body as { id: string }).id;
    };

    // A second sign-in is a login, not a second account.
    expect(await idOf(first)).toBe(await idOf(second));

    await cleanup('sub_e2e_stable');
  });
});
