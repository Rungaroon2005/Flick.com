import { Logger, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

describe('PrismaExceptionFilter', () => {
  it('maps a unique violation to 409 without leaking the column', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const json = jest.fn<void, [unknown]>();
    const response = {
      status: jest.fn().mockReturnThis(),
      json,
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const err = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2002',
      clientVersion: '7',
      meta: { target: ['phone'] },
    });

    new PrismaExceptionFilter().catch(err, host);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'ข้อมูลนี้ถูกใช้งานแล้ว',
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('phone');
  });
});
