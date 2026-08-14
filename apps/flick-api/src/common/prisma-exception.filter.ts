import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    // Metadata can identify the conflicting field. Keep it in server logs for
    // diagnosis, but return only the stable Thai message below to the client.
    this.logger.error({ code: err.code, meta: err.meta });
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message } = this.map(err);
    response.status(status).json({ statusCode: status, message });
  }

  private map(err: Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return { status: 409, message: 'ข้อมูลนี้ถูกใช้งานแล้ว' };
      case 'P2025':
        return { status: 404, message: 'ไม่พบข้อมูลที่ต้องการ' };
      case 'P2003':
        return { status: 400, message: 'ข้อมูลอ้างอิงไม่ถูกต้อง' };
      default:
        return { status: 500, message: 'เกิดข้อผิดพลาดของระบบ' };
    }
  }
}
