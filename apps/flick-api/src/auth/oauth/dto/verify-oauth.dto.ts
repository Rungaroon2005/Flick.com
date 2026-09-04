import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Note what `displayName` is NOT: an identity. Apple sends the user's name
 * beside the token rather than inside it, so this field is caller-supplied and
 * unverified. It may fill a display name when the token carried none, and it
 * must never influence identity, email, or linking.
 */
export class VerifyOAuthDto {
  @IsIn(['google', 'apple'])
  provider: 'google' | 'apple';

  @IsString()
  @MinLength(16)
  @MaxLength(8192)
  idToken: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  nonce: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}
