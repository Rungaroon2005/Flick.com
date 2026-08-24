import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OtpChannel } from '@prisma/client';

export class VerifyOtpDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  destination: string;

  @IsOptional()
  @IsEnum(OtpChannel)
  channel?: OtpChannel;

  @IsString()
  @Length(4, 4)
  ref: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
