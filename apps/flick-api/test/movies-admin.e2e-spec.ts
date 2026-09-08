import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';

const ADMIN_ID = 'e2e-movies-admin-admin';
const NON_ADMIN_ID = 'e2e-movies-admin-user';

const validBody = {
  title: 'E2E Admin Fixture',
  description: 'Throwaway fixture for movies-admin.e2e-spec.',
  posterUrl: 'https://example.com/poster.jpg',
  year: 2026,
  contentRating: 'ทั่วไป',
  genreSlugs: ['drama'],
};

describe('Movies admin write path (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminCookie: string;
  let nonAdminCookie: string;
  const createdMovieIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);

    // JwtStrategy reloads the user fresh from the DB by `sub` and trusts
    // ITS role column, never a claim in the token -- same fixture pattern
    // as scene-markers.e2e-spec.ts.
    const admin = await prisma.user.upsert({
      where: { id: ADMIN_ID },
      create: {
        id: ADMIN_ID,
        displayName: 'E2E Movies Admin',
        role: Role.ADMIN,
        phone: '+66800000098',
      },
      update: { role: Role.ADMIN },
    });
    const nonAdmin = await prisma.user.upsert({
      where: { id: NON_ADMIN_ID },
      create: {
        id: NON_ADMIN_ID,
        displayName: 'E2E Movies User',
        role: Role.USER,
        phone: '+66800000099',
      },
      update: { role: Role.USER },
    });

    adminCookie = `access_token=${await jwt.signAsync({ sub: admin.id })}`;
    nonAdminCookie = `access_token=${await jwt.signAsync({ sub: nonAdmin.id })}`;
  });

  afterAll(async () => {
    await prisma.movie.deleteMany({ where: { id: { in: createdMovieIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, NON_ADMIN_ID] } },
    });
    await app.close();
  });

  it('creates a movie with a valid ISO 3166-1 alpha-2 originCountry', async () => {
    const res = await request(app.getHttpServer())
      .post('/movies')
      .set('Cookie', adminCookie)
      .send({ ...validBody, originCountry: 'KR' })
      .expect(201);

    createdMovieIds.push((res.body as { id: string }).id);
    expect(res.body).toMatchObject({ originCountry: 'KR' });
  });

  it('rejects a non-ISO originCountry with 400, not a 500 from Postgres', async () => {
    await request(app.getHttpServer())
      .post('/movies')
      .set('Cookie', adminCookie)
      .send({ ...validBody, originCountry: 'Korea' })
      .expect(400);
  });

  it('PATCH updates originCountry on an existing movie', async () => {
    const created = await request(app.getHttpServer())
      .post('/movies')
      .set('Cookie', adminCookie)
      .send(validBody)
      .expect(201);
    const movieId = (created.body as { id: string }).id;
    createdMovieIds.push(movieId);

    const patched = await request(app.getHttpServer())
      .patch(`/movies/${movieId}`)
      .set('Cookie', adminCookie)
      .send({ originCountry: 'JP' })
      .expect(200);
    expect(patched.body).toMatchObject({ originCountry: 'JP' });

    // findOne only returns PUBLISHED movies, and this fixture is created
    // with the default (non-published) status -- read back through Prisma
    // directly rather than assuming the public route can see it.
    const row = await prisma.movie.findUniqueOrThrow({
      where: { id: movieId },
    });
    expect(row.originCountry).toBe('JP');
  });

  it('PATCH rejects a non-ISO originCountry with 400', async () => {
    const created = await request(app.getHttpServer())
      .post('/movies')
      .set('Cookie', adminCookie)
      .send(validBody)
      .expect(201);
    const movieId = (created.body as { id: string }).id;
    createdMovieIds.push(movieId);

    await request(app.getHttpServer())
      .patch(`/movies/${movieId}`)
      .set('Cookie', adminCookie)
      .send({ originCountry: 'not-a-code' })
      .expect(400);
  });

  it('401s an anonymous PATCH caller', async () => {
    await request(app.getHttpServer())
      .patch('/movies/anything')
      .send({ originCountry: 'KR' })
      .expect(401);
  });

  it('403s an authenticated non-admin PATCH caller', async () => {
    await request(app.getHttpServer())
      .patch('/movies/anything')
      .set('Cookie', nonAdminCookie)
      .send({ originCountry: 'KR' })
      .expect(403);
  });

  it('404s a PATCH for a movie id that does not exist', async () => {
    await request(app.getHttpServer())
      .patch('/movies/does-not-exist')
      .set('Cookie', adminCookie)
      .send({ originCountry: 'KR' })
      .expect(404);
  });
});
