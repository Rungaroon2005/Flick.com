import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { PrismaService } from './prisma.service';

describe('AppController', () => {
  let appController: AppController;
  const prisma = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('checks the database and reports healthy', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
        db: 'up',
      });
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
