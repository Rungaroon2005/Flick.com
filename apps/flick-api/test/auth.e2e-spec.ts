import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  const seedCredentials = {
    email: 'e2e-free@flick.test',
    password: 'flick-e2e-password',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts applies this at bootstrap; the e2e harness must too, or the
    // JwtStrategy cookie extractor never sees req.cookies.
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a protected route without a cookie', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('accepts a protected route with the login cookie', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send(seedCredentials)
      .expect(200);

    const cookies = login.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookies)
      .expect(200);

    expect((meRes.body as { email: string }).email).toBe(seedCredentials.email);
  });

  it('never returns the access token in a response body', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send(seedCredentials)
      .expect(200);

    expect(JSON.stringify(login.body)).not.toContain('access_token');
    expect(login.headers['set-cookie']).toBeDefined();
  });
});
