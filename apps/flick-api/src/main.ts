import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import type { Application } from 'express';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const trustProxyHops = Number(
    config.get<string | number>('TRUST_PROXY_HOPS', 0),
  );
  if (trustProxyHops > 0) {
    const expressApp = app.getHttpAdapter().getInstance() as Application;
    expressApp.set('trust proxy', trustProxyHops);
  }
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(config.get<number>('PORT', 3001));
}
bootstrap().catch((err) => console.error(err));
