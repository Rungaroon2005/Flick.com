import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser()); // main.ts applies this at bootstrap; the e2e harness must too, or JwtStrategy's cookie extractor never sees req.cookies
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects /auth/me without a cookie', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('accepts /auth/me with the cookie from a real login — guards the JwtModule/JwtStrategy secret-agreement bug', async () => {
    const email = `e2e-auth-${Date.now()}@flick.test`;
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ displayName: 'E2E Auth Test', email, password: 'password123' })
      .expect(201);

    // access_token must never appear in the response body
    expect(JSON.stringify(registerRes.body)).not.toContain('access_token');

    const cookies = registerRes.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookies)
      .expect(200);

    const me = meRes.body as { email: string; displayName: string };
    expect(me.email).toBe(email);
    // The frontend session (Task 3.1) renders this; /auth/me must carry it.
    expect(me.displayName).toBe('E2E Auth Test');
  });
});
