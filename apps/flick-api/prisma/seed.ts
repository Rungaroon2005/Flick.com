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
