import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';

// A real seeded episode (prisma/seed.ts), already used by entitlement.e2e-spec.
const EPISODE_ID = 'sathu-premium';
const ADMIN_ID = 'e2e-scene-marker-admin';
const NON_ADMIN_ID = 'e2e-scene-marker-user';

describe('Scene markers admin (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminCookie: string;
  let nonAdminCookie: string;

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
    await prisma.sceneMarker.deleteMany({ where: { episodeId: EPISODE_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, NON_ADMIN_ID] } },
    });
    await app.close();
  });

  it('401s an anonymous caller -- no @Public() on this controller', async () => {
    await request(app.getHttpServer())
      .get(`/admin/episodes/${EPISODE_ID}/markers`)
      .expect(401);
  });

  it('403s an authenticated caller who is not an admin', async () => {
    await request(app.getHttpServer())
      .get(`/admin/episodes/${EPISODE_ID}/markers`)
      .set('Cookie', nonAdminCookie)
      .expect(403);
  });

  it('rejects an unrecognized kind with 400, not a 500 from Prisma', async () => {
    await request(app.getHttpServer())
      .put(`/admin/episodes/${EPISODE_ID}/markers/NOT_A_KIND`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 0, endSeconds: 30 })
      .expect(400);
  });

  it('rejects endSeconds <= startSeconds with 400', async () => {
    await request(app.getHttpServer())
      .put(`/admin/episodes/${EPISODE_ID}/markers/RECAP`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 30, endSeconds: 10 })
      .expect(400);
  });

  it('upserts idempotently, keyed on (episodeId, kind), and invalidates no duplicate row', async () => {
    await request(app.getHttpServer())
      .put(`/admin/episodes/${EPISODE_ID}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 0, endSeconds: 30 })
      .expect(200);

    // A retried PUT with a different range must UPDATE, not duplicate.
    await request(app.getHttpServer())
      .put(`/admin/episodes/${EPISODE_ID}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .send({ startSeconds: 0, endSeconds: 35 })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/admin/episodes/${EPISODE_ID}/markers`)
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
      .delete(`/admin/episodes/${EPISODE_ID}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .expect(200);

    // Removing an already-absent marker is a no-op, not a 404.
    await request(app.getHttpServer())
      .delete(`/admin/episodes/${EPISODE_ID}/markers/INTRO`)
      .set('Cookie', adminCookie)
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/admin/episodes/${EPISODE_ID}/markers`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
