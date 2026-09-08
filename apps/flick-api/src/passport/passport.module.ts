import { Module } from '@nestjs/common';
import { PassportService } from './passport.service';
import { PassportController } from './passport.controller';

@Module({
  controllers: [PassportController],
  providers: [PassportService],
})
export class PassportModule {}
