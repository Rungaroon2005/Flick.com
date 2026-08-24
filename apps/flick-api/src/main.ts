import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import type { Application } from 'express';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap() {
  // rawBody keeps the ORIGINAL request bytes on req.rawBody alongside the
  // parsed body. The payment webhook's HMAC is computed over exactly what the
  // gateway sent; verifying a re-serialized JSON.stringify of the parsed body
  // would mismatch on key order and whitespace and reject every real webhook.
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
