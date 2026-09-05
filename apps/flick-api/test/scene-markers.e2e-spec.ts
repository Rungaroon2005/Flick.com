import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ContentStatus, Role } from '@prisma/client';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';

const MOVIE_ID = 'e2e-scene-marker-movie';
const ADMIN_ID = 'e2e-scene-marker-admin';
const NON_ADMIN_ID = 'e2e-scene-marker-user';

describe('Scene markers admin (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminCookie: string;
  let nonAdminCookie: string;
  let episodeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);

    // A throwaway movie/season/episode of this suite's own, not a shared
    // seed.ts fixture like sathu-premium: this suite upserts and deletes
    // markers by episodeId, and reusing a fixture other seed data (or other
    // e2e specs) depends on would let this suite's cleanup wipe rows it
    // never created -- including the seeded INTRO/CREDITS markers on
    // sathu-premium, which share the same kind values this suite exercises.
    await prisma.movie.deleteMany({ where: { id: MOVIE_ID } });
    const movie = await prisma.movie.create({
      data: {
        id: MOVIE_ID,
        title: 'E2E Scene Marker Fixture',
        description: 'Throwaway fixture for scene-markers.e2e-spec.',
        posterUrl: '/posters/sathu.jpg',
        year: 2026,
        contentRating: 'ทั่วไป',
        status: ContentStatus.PUBLISHED,
        seasons: {
          create: [
            {
              seasonNumber: 1,
              title: 'S1',
              episodeCount: 1,
              episodes: {
                create: [
                  {
                    episodeNumber: 1,
                    title: 'E1',
                    description: 'Fixture episode',
                    durationMinutes: 10,
                    thumbnailUrl: '/posters/sathu.jpg',
                    releaseDate: new Date(),
                  },
                ],
              },
            },
          ],
        },
      },
      include: { seasons: { include: { episodes: true } } },
    });
    episodeId = movie.seasons[0].episodes[0].id;

    // JwtStrategy reloads the user fresh from the DB by `sub` and trusts
    // ITS role column, never a claim in the token -- so the fixture is a
    // real row, not just a signed payload.
    const admin = await prisma.user.upsert({
      where: { id: ADMIN_ID },
      create: {
        id: ADMIN_ID,
        displayName: 'E2E Admin',
        role: Role.ADMIN,
        phone: '+66800000097',
      },
      update: { role: Role.ADMIN },
    });
    const nonAdmin = await prisma.user.upsert({
      where: { id: NON_ADMIN_ID },
      create: {
        id: NON_ADMIN_ID,
        displayName: 'E2E User',
        role: Role.USER,
        phone: '+66800000096',
      },
      update: { role: Role.USER },
    });

    adminCookie = `access_token=${await jwt.signAsync({ sub: admin.id })}`;
    nonAdminCookie = `access_token=${await jwt.signAsync({ sub: nonAdmin.id })}`;
  });

  afterAll(async () => {
    // Cascades to seasons/episodes/scene_markers -- see schema.prisma
    // onDelete: Cascade on each of those relations.
    await prisma.movie.deleteMany({ where: { id: MOVIE_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, NON_ADMIN_ID] } },
    });
    await app.close();
  });

  it('401s an anonymous caller -- no @Public() on this controller', async () => {
    await request(app.getHttpServer())
      .get(`/admin/episodes/${episodeId}/markers`)
      .expect(401);
  });

  it('403s an authenticated caller who is not an admin', async () => {
    await request(app.getHttpServer())
      .get(`/admin/episodes/${episodeId}/markers`)
      .set('Cookie', nonAdminCookie)
      .expect(403);
  });

  it('rejects an unrecognized kind with 400, not a 500 from Prisma', async () => {
    await request(app.getHttpServer())
      .put(`/admin/episodes/${episodeId}/markers/NOT_A_KIND`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 0, endSeconds: 30 })
      .expect(400);
  });

  it('rejects endSeconds <= startSeconds with 400', async () => {
    await request(app.getHttpServer())
      .put(`/admin/episodes/${episodeId}/markers/RECAP`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 30, endSeconds: 10 })
      .expect(400);
  });

  it('upserts idempotently, keyed on (episodeId, kind), and invalidates no duplicate row', async () => {
    await request(app.getHttpServer())
      .put(`/admin/episodes/${episodeId}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 0, endSeconds: 30 })
      .expect(200);

    // A retried PUT with a different range must UPDATE, not duplicate.
    await request(app.getHttpServer())
      .put(`/admin/episodes/${episodeId}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 0, endSeconds: 35 })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/admin/episodes/${episodeId}/markers`)
      .set('Cookie', adminCookie)
      .expect(200);

    const introMarkers = (list.body as Array<{ kind: string }>).filter(
      (m) => m.kind === 'INTRO',
    );
    expect(introMarkers).toHaveLength(1);
    expect(introMarkers[0]).toMatchObject({ startSeconds: 0, endSeconds: 35 });
  });

  it('DELETE removes the marker and is idempotent', async () => {
    await request(app.getHttpServer())
      .delete(`/admin/episodes/${episodeId}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .expect(200);

    // Removing an already-absent marker is a no-op, not a 404.
    await request(app.getHttpServer())
      .delete(`/admin/episodes/${episodeId}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/admin/episodes/${episodeId}/markers`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
