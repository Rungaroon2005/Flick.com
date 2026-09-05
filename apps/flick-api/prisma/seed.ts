import { PrismaClient, ContentStatus } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://macintosh@localhost:5432/flickdb?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Idempotency: this script always used bare `.create()`, so re-running it
  // against a database that already has these fixture rows (e.g. after
  // switching the seeded user from password to OTP auth) fails on the
  // primary-key unique constraint. Clear only the known fixture rows this
  // script owns — by id — before recreating them. Movie deletion cascades to
  // its seasons/episodes/movie_genres rows (see schema.prisma onDelete:
  // Cascade); genres themselves are shared and left alone via
  // connectOrCreate below.
  //
  // The User row is handled differently, below (upsert, not delete-then-
  // create): PaymentEvent.user is onDelete: Restrict, so deleting
  // 'e2e-free-user' would fail with a foreign-key violation (P2003) the
  // moment a later e2e suite has recorded a payment event against it.
  const seedMovieIds = [
    'sathu',
    'dao-sindome',
    'neephee',
    'ngao',
    'rak',
    'sena',
    'e2e-draft',
  ];
  await prisma.movie.deleteMany({ where: { id: { in: seedMovieIds } } });

  // Create Movies
  const sathu = await prisma.movie.create({
    data: {
      id: 'sathu',
      title: 'สาธุ',
      description: 'ชีวิตของนักธุรกิจที่พังทลาย เมื่อภารกิจไม่สำเร็จ กลุ่มคนเหล่านี้ จึงรวมกลุ่มกันเพื่อหาเงินมาใช้หนี้',
      posterUrl: '/posters/sathu.jpg',
      // NewPlan C2 (press-and-hold poster preview) fixture data -- reuses
      // the same free-preview clip already serving as episode 1's video.
      trailerUrl: '/videos/movie1-preview.m4v',
      year: 2025,
      contentRating: 'ผู้ใหญ่',
      status: ContentStatus.PUBLISHED,
      genres: {
        create: [{
          genre: {
            connectOrCreate: {
              where: { slug: 'drama' },
              create: { name: 'ดราม่า', slug: 'drama' }
            }
          }
        }]
      },
      moods: {
        create: [{ mood: { connectOrCreate: { where: { slug: 'stressed' }, create: { slug: 'stressed', name: 'เครียด', emoji: '😣' } } } }, { mood: { connectOrCreate: { where: { slug: 'inspired' }, create: { slug: 'inspired', name: 'อยากได้แรงบันดาลใจ', emoji: '✨' } } } }]
      },
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 5,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'อยู่อย่างยาก', description: 'คลิปตัวอย่างจาก movie1.MOV', durationMinutes: 1, thumbnailUrl: '/posters/sathu.jpg', videoUrl: '/videos/movie1-preview.m4v', releaseDate: new Date() },
                { id: 'sathu-premium', episodeNumber: 2, title: 'อยู่อย่างง่าย', description: 'ตอนที่ 2', durationMinutes: 10, thumbnailUrl: '/posters/sathu.jpg', videoUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', isPremium: true, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  // Demonstrates smart-skip and finish-time estimation (NewPlan Phase B)
  // against real fixture data. sathu-premium runs 10 minutes (600s); cascade
  // from the movie deleteMany above already clears these on re-run, since
  // scene_markers cascades from episodes, which cascades from movies.
  await prisma.sceneMarker.createMany({
    data: [
      { episodeId: 'sathu-premium', kind: 'INTRO', startSeconds: 0, endSeconds: 30 },
      { episodeId: 'sathu-premium', kind: 'CREDITS', startSeconds: 560, endSeconds: 600 },
    ],
  });

  const dao = await prisma.movie.create({
    data: {
      id: 'dao-sindome',
      title: 'ดาวซินโดม',
      description: 'เรื่องราวของเด็กหนุ่มที่ค้นพบความลับของจักรวาลผ่านเทคโนโลยีล้ำสมัยในกรุงเทพมหานคร',
      posterUrl: '/posters/dao.jpg',
      trailerUrl: '/videos/movie2-preview.m4v',
      year: 2025,
      contentRating: 'ทั่วไป',
      status: ContentStatus.PUBLISHED,
      genres: {
        create: [{
          genre: {
            connectOrCreate: {
              where: { slug: 'sci-fi' },
              create: { name: 'ไซไฟ', slug: 'sci-fi' }
            }
          }
        }]
      },
      moods: {
        create: [{ mood: { connectOrCreate: { where: { slug: 'thrill' }, create: { slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' } } } }]
      },
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'เพื่อนไม่คบ', description: 'คลิปตัวอย่างจาก movie2.MOV', durationMinutes: 1, thumbnailUrl: '/posters/dao.jpg', videoUrl: '/videos/movie2-preview.m4v', releaseDate: new Date() },
                { episodeNumber: 2, title: 'ดาวตก', description: 'ตอนที่ 2', durationMinutes: 14, thumbnailUrl: '/posters/dao.jpg', isPremium: true, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  const neephee = await prisma.movie.create({
    data: {
      id: 'neephee',
      title: 'หนีผี',
      description: 'กลุ่มเพื่อนติดค้างในบ้านร้างกลางป่า และต้องเอาชีวิตรอดจากวิญญาณที่สิงสู่อยู่ที่นั่นให้ได้ก่อนรุ่งสาง',
      posterUrl: '/posters/neephee.jpg',
      year: 2025,
      contentRating: 'ผู้ใหญ่',
      status: ContentStatus.PUBLISHED,
      genres: {
        create: [{
          genre: {
            connectOrCreate: {
              where: { slug: 'horror' },
              create: { name: 'สยองขวัญ', slug: 'horror' }
            }
          }
        }]
      },
      moods: {
        create: [{ mood: { connectOrCreate: { where: { slug: 'stressed' }, create: { slug: 'stressed', name: 'เครียด', emoji: '😣' } } } }]
      },
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'คืนแรก', description: 'ตอนที่ 1', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', releaseDate: new Date() },
                { episodeNumber: 2, title: 'เสียงเรียก', description: 'ตอนที่ 2', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', isPremium: true, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  const ngao = await prisma.movie.create({
    data: {
      id: 'ngao',
      title: 'เงา',
      description: 'นักสืบหญิงไล่ล่าองค์กรอาชญากรรมที่อยู่เบื้องหลังคดีฆาตกรรมต่อเนื่องกลางกรุงเทพฯ',
      posterUrl: '/posters/ngao.jpg',
      year: 2025,
      contentRating: 'ผู้ใหญ่',
      status: ContentStatus.PUBLISHED,
      genres: {
        create: [{
          genre: {
            connectOrCreate: {
              where: { slug: 'crime' },
              create: { name: 'อาชญากรรม', slug: 'crime' }
            }
          }
        }]
      },
      moods: {
        create: [{ mood: { connectOrCreate: { where: { slug: 'thrill' }, create: { slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' } } } }]
      },
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'ร่องรอย', description: 'ตอนที่ 1', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', releaseDate: new Date() },
                { episodeNumber: 2, title: 'ผู้ต้องสงสัย', description: 'ตอนที่ 2', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', isPremium: true, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  const rak = await prisma.movie.create({
    data: {
      id: 'rak',
      title: 'รัก',
      description: 'เรื่องราวความรักของหนุ่มสาวสองคนที่พบกันโดยบังเอิญ และต้องฝ่าฟันอุปสรรคเพื่อรักษาความสัมพันธ์ไว้',
      posterUrl: '/posters/rak.jpg',
      year: 2025,
      contentRating: 'ทั่วไป',
      status: ContentStatus.PUBLISHED,
      genres: {
        create: [{
          genre: {
            connectOrCreate: {
              where: { slug: 'romance' },
              create: { name: 'โรแมนติก', slug: 'romance' }
            }
          }
        }]
      },
      moods: {
        create: [{ mood: { connectOrCreate: { where: { slug: 'lonely' }, create: { slug: 'lonely', name: 'เหงา', emoji: '🌙' } } } }, { mood: { connectOrCreate: { where: { slug: 'cry' }, create: { slug: 'cry', name: 'อยากร้องไห้', emoji: '😢' } } } }]
      },
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'พบกันครั้งแรก', description: 'ตอนที่ 1', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', releaseDate: new Date() },
                { episodeNumber: 2, title: 'สัญญาใจ', description: 'ตอนที่ 2', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', isPremium: true, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  const sena = await prisma.movie.create({
    data: {
      id: 'sena',
      title: 'ปฏิบัติการเสนา',
      description: 'หน่วยรบพิเศษต้องบุกฝ่าแนวข้าศึกเพื่อกู้ตัวประกันก่อนที่ทุกอย่างจะสายเกินไป',
      posterUrl: '/posters/sena.jpg',
      year: 2025,
      contentRating: 'ผู้ใหญ่',
      status: ContentStatus.PUBLISHED,
      genres: {
        create: [{
          genre: {
            connectOrCreate: {
              where: { slug: 'action' },
              create: { name: 'แอ็คชั่น', slug: 'action' }
            }
          }
        }]
      },
      moods: {
        create: [{ mood: { connectOrCreate: { where: { slug: 'thrill' }, create: { slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' } } } }, { mood: { connectOrCreate: { where: { slug: 'laugh' }, create: { slug: 'laugh', name: 'อยากหัวเราะ', emoji: '😂' } } } }]
      },
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'บุกเดี่ยว', description: 'ตอนที่ 1', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', releaseDate: new Date() },
                { episodeNumber: 2, title: 'ภารกิจสุดท้าย', description: 'ตอนที่ 2', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', isPremium: true, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  // Security fixtures used by the end-to-end suite. The draft must exist so
  // public-list regressions are observable, and the premium episode above has
  // a real non-null URL so a videoUrl leak test cannot pass on all-null data.
  await prisma.movie.create({
    data: {
      id: 'e2e-draft',
      title: 'E2E Draft — Never Public',
      description: 'Draft fixture for public content-filter regression tests.',
      posterUrl: '/posters/sathu.jpg',
      year: 2026,
      contentRating: 'ทั่วไป',
      status: ContentStatus.DRAFT,
    },
  });

  // upsert, not delete-then-create: PaymentEvent rows accumulated against
  // this user by other e2e suites would make a delete fail with a
  // foreign-key violation (see the comment above). update explicitly nulls
  // passwordHash so re-seeding over a row left behind by an older
  // password-based seed actually clears it, rather than leaving a stale
  // hash on a supposedly passwordless account.
  await prisma.user.upsert({
    where: { id: 'e2e-free-user' },
    update: {
      email: 'e2e-free@flick.test',
      // The phone IS the login identity now — stored normalized, exactly as
      // OtpService writes it.
      phone: '+66800000001',
      displayName: 'E2E Free User',
      isVerified: true,
      passwordHash: null,
    },
    create: {
      id: 'e2e-free-user',
      email: 'e2e-free@flick.test',
      // The phone IS the login identity now — stored normalized, exactly as
      // OtpService writes it.
      phone: '+66800000001',
      displayName: 'E2E Free User',
      isVerified: true,
      // passwordHash intentionally absent — passwordless.
    },
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
