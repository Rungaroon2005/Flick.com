import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OtpChannel } from '@prisma/client';

export class RequestOtpDto {
  /** A phone number in any Thai format, or an email. Normalized server-side. */
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  destination: string;

  @IsOptional()
  @IsEnum(OtpChannel)
  channel?: OtpChannel;
}
