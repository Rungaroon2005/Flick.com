import { PrismaClient, ContentStatus } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://macintosh@localhost:5432/flickdb?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Create Movies
  const sathu = await prisma.movie.create({
    data: {
      id: 'sathu',
      title: 'สาธุ',
      description: 'ชีวิตของนักธุรกิจที่พังทลาย เมื่อภารกิจไม่สำเร็จ กลุ่มคนเหล่านี้ จึงรวมกลุ่มกันเพื่อหาเงินมาใช้หนี้',
      posterUrl: '/posters/sathu.jpg',
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
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 5,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'อยู่อย่างยาก', description: 'ตอนที่ 1', durationMinutes: 10, thumbnailUrl: '/posters/sathu.jpg', coinCost: 0, releaseDate: new Date() },
                { episodeNumber: 2, title: 'อยู่อย่างง่าย', description: 'ตอนที่ 2', durationMinutes: 10, thumbnailUrl: '/posters/sathu.jpg', coinCost: 10, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
    },
  });

  const dao = await prisma.movie.create({
    data: {
      id: 'dao-sindome',
      title: 'ดาวซินโดม',
      description: 'เรื่องราวของเด็กหนุ่มที่ค้นพบความลับของจักรวาลผ่านเทคโนโลยีล้ำสมัยในกรุงเทพมหานคร',
      posterUrl: '/posters/dao.jpg',
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
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'เพื่อนไม่คบ', description: 'ตอนที่ 1', durationMinutes: 14, thumbnailUrl: '/posters/dao.jpg', coinCost: 0, releaseDate: new Date() },
                { episodeNumber: 2, title: 'ดาวตก', description: 'ตอนที่ 2', durationMinutes: 14, thumbnailUrl: '/posters/dao.jpg', coinCost: 10, releaseDate: new Date() },
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
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'คืนแรก', description: 'ตอนที่ 1', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', coinCost: 0, releaseDate: new Date() },
                { episodeNumber: 2, title: 'เสียงเรียก', description: 'ตอนที่ 2', durationMinutes: 12, thumbnailUrl: '/posters/neephee.jpg', coinCost: 10, releaseDate: new Date() },
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
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'ร่องรอย', description: 'ตอนที่ 1', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', coinCost: 0, releaseDate: new Date() },
                { episodeNumber: 2, title: 'ผู้ต้องสงสัย', description: 'ตอนที่ 2', durationMinutes: 15, thumbnailUrl: '/posters/ngao.jpg', coinCost: 10, releaseDate: new Date() },
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
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'พบกันครั้งแรก', description: 'ตอนที่ 1', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', coinCost: 0, releaseDate: new Date() },
                { episodeNumber: 2, title: 'สัญญาใจ', description: 'ตอนที่ 2', durationMinutes: 13, thumbnailUrl: '/posters/rak.jpg', coinCost: 10, releaseDate: new Date() },
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
      seasons: {
        create: [
          {
            seasonNumber: 1,
            title: 'ซีซั่น 1',
            episodeCount: 2,
            episodes: {
              create: [
                { episodeNumber: 1, title: 'บุกเดี่ยว', description: 'ตอนที่ 1', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', coinCost: 0, releaseDate: new Date() },
                { episodeNumber: 2, title: 'ภารกิจสุดท้าย', description: 'ตอนที่ 2', durationMinutes: 16, thumbnailUrl: '/posters/sena.jpg', coinCost: 10, releaseDate: new Date() },
              ],
            },
          },
        ],
      },
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
